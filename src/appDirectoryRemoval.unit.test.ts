import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { displaceRunningExecutable, isDisplacementRequired, removeAppDirectory } from "./appDirectoryRemoval";

const removal = vi.hoisted(() => ({
	outcome: "real" as "real" | "throws" | "silent",
}));

vi.mock("node:fs", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs")>();

	return {
		...fs,
		rmSync: vi.fn((path: string, options?: Parameters<typeof fs.rmSync>[1]) => {
			if (removal.outcome === "throws") {
				throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
			}

			if (removal.outcome === "silent") {
				return;
			}

			fs.rmSync(path, options);
		}),
	};
});

const roots: Array<string> = [];

afterEach(() => {
	removal.outcome = "real";

	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true, maxRetries: 3 });
	}
});

describe("isDisplacementRequired", () => {
	const appDirectory = "C:\\Users\\someone\\AppData\\Local\\znpm";

	it("holds for an executable inside the app directory on win32", () => {
		expect(isDisplacementRequired(join(appDirectory, "bin", "znpm.exe"), appDirectory, "win32")).toBe(true);
	});

	it("holds across separator and case spellings of one path", () => {
		expect(isDisplacementRequired("C:/Users/someone/AppData/Local/ZNPM/bin/znpm.exe", appDirectory, "win32")).toBe(
			true,
		);
	});

	it("holds for an executable inside an npm platform package", () => {
		expect(
			isDisplacementRequired(
				"C:\\Users\\someone\\AppData\\Roaming\\npm\\node_modules\\@zcross\\znpm-win32-x64\\znpm.exe",
				appDirectory,
				"win32",
			),
		).toBe(true);
	});

	it("fails for a sibling directory whose name extends the app directory's", () => {
		expect(isDisplacementRequired(`${appDirectory}-other\\bin\\znpm.exe`, appDirectory, "win32")).toBe(false);
	});

	it("fails for an executable outside the app directory and outside a package", () => {
		expect(isDisplacementRequired("D:\\projects\\znpm\\dist\\znpm-windows-x64.exe", appDirectory, "win32")).toBe(
			false,
		);
	});

	it("fails on posix, where a running executable unlinks in place", () => {
		const posixAppDirectory = "/home/someone/.local/share/znpm";

		expect(isDisplacementRequired(`${posixAppDirectory}/bin/znpm`, posixAppDirectory, "linux")).toBe(false);
	});
});

describe("displaceRunningExecutable", () => {
	it("moves the executable into the temporary directory under its pid", () => {
		const root = openRoot();
		const executablePath = join(root, "bin", "znpm.exe");
		const temporaryDirectory = join(root, "temp");

		mkdirSync(join(root, "bin"), { recursive: true });
		mkdirSync(temporaryDirectory, { recursive: true });
		writeFileSync(executablePath, "binary", "utf8");

		const displacedPath = displaceRunningExecutable(executablePath, temporaryDirectory, 4242);

		expect(displacedPath).toBe(join(temporaryDirectory, "znpm-uninstalled-4242.exe"));
		expect(existsSync(executablePath)).toBe(false);
		expect(readFileSync(displacedPath, "utf8")).toBe("binary");
	});

	it("names the executable it could not move", () => {
		const root = openRoot();
		const executablePath = join(root, "bin", "znpm.exe");

		expect(() => displaceRunningExecutable(executablePath, root, 7)).toThrow(executablePath);
	});
});

describe("removeAppDirectory", () => {
	it("removes a populated app directory", () => {
		const appDirectory = join(openRoot(), "znpm");

		mkdirSync(join(appDirectory, "npm-wrapper"), { recursive: true });
		writeFileSync(join(appDirectory, "npm-wrapper", "npm.exe"), "wrapper", "utf8");
		writeFileSync(join(appDirectory, "state.json"), "{}", "utf8");

		removeAppDirectory(appDirectory);

		expect(existsSync(appDirectory)).toBe(false);
	});

	it("passes over an app directory that is already gone", () => {
		const appDirectory = join(openRoot(), "znpm");

		expect(() => {
			removeAppDirectory(appDirectory);
		}).not.toThrow();
	});

	it("names the file that survives a removal that threw", () => {
		const appDirectory = join(openRoot(), "znpm");
		const survivingPath = join(appDirectory, "npm-wrapper", "npm.exe");

		mkdirSync(join(appDirectory, "npm-wrapper"), { recursive: true });
		writeFileSync(survivingPath, "wrapper", "utf8");

		removal.outcome = "throws";

		expect(() => {
			removeAppDirectory(appDirectory);
		}).toThrow(
			`znpm cannot remove ${survivingPath}; close whatever holds it open, then remove ${appDirectory} by hand`,
		);
		expect(existsSync(survivingPath)).toBe(true);
	});

	it("refuses to report success over a tree the removal left standing", () => {
		const appDirectory = join(openRoot(), "znpm");

		mkdirSync(appDirectory, { recursive: true });

		removal.outcome = "silent";

		expect(() => {
			removeAppDirectory(appDirectory);
		}).toThrow(
			`znpm cannot remove ${appDirectory}; close whatever holds it open, then remove ${appDirectory} by hand`,
		);
	});

	it("passes when the removal threw over a tree that is gone anyway", () => {
		const appDirectory = join(openRoot(), "znpm");

		removal.outcome = "throws";

		expect(() => {
			removeAppDirectory(appDirectory);
		}).not.toThrow();
	});
});

function openRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "znpm-removal-"));

	roots.push(root);

	return root;
}
