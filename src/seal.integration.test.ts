import { chmodSync, lstatSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sealPackageDirectory } from "./seal";

describe("sealPackageDirectory", () => {
	let temporaryRoot: string;
	let packageDirectory: string;

	beforeEach(() => {
		temporaryRoot = mkdtempSync(join(tmpdir(), "znpm-seal-"));
		packageDirectory = join(temporaryRoot, "package");
		mkdirSync(packageDirectory);
		writeFileSync(join(packageDirectory, "index.js"), "module.exports = 1\n", "utf8");
		writeFileSync(join(packageDirectory, "package.json"), "{}\n", "utf8");
		mkdirSync(join(packageDirectory, "bin"));
		writeFileSync(join(packageDirectory, "bin", "cli.js"), "#!/usr/bin/env node\n", "utf8");
		chmodSync(join(packageDirectory, "bin", "cli.js"), 0o755);
		mkdirSync(join(packageDirectory, "node_modules", "nested"), { recursive: true });
		writeFileSync(join(packageDirectory, "node_modules", "nested", "index.js"), "nested\n", "utf8");
	});

	afterEach(() => {
		rmSync(temporaryRoot, { recursive: true, force: true });
	});

	it("seals files as 0o444, or 0o555 when an exec bit is set on POSIX", () => {
		sealPackageDirectory(packageDirectory);

		expect(statSync(join(packageDirectory, "index.js")).mode & 0o777).toBe(0o444);
		expect(statSync(join(packageDirectory, "package.json")).mode & 0o777).toBe(0o444);

		if (process.platform === "win32") {
			expect(statSync(join(packageDirectory, "bin", "cli.js")).mode & 0o777).toBe(0o444);
		} else {
			expect(statSync(join(packageDirectory, "bin", "cli.js")).mode & 0o777).toBe(0o555);
		}
	});

	it("leaves directories writable", () => {
		sealPackageDirectory(packageDirectory);

		const addedPath = join(packageDirectory, "added.txt");

		writeFileSync(addedPath, "ok\n", "utf8");
		expect(statSync(addedPath).isFile()).toBe(true);
	});

	it("leaves nested node_modules files untouched", () => {
		const nestedPath = join(packageDirectory, "node_modules", "nested", "index.js");
		const modeBefore = statSync(nestedPath).mode;

		sealPackageDirectory(packageDirectory);

		expect(statSync(nestedPath).mode).toBe(modeBefore);
		expect(statSync(nestedPath).mode & 0o222).not.toBe(0);
	});

	it("leaves symlinks untouched", () => {
		const targetPath = join(temporaryRoot, "target.js");
		const linkPath = join(packageDirectory, "link.js");

		writeFileSync(targetPath, "target\n", "utf8");

		try {
			symlinkSync(targetPath, linkPath);
		} catch (error: unknown) {
			if (isErrnoException(error) && (error.code === "EPERM" || error.code === "ENOTSUP")) {
				return;
			}

			throw error;
		}

		const targetModeBefore = statSync(targetPath).mode;

		sealPackageDirectory(packageDirectory);

		expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
		expect(statSync(targetPath).mode).toBe(targetModeBefore);
	});

	it("throws EPERM on win32 or EACCES on POSIX for an in-place write", () => {
		sealPackageDirectory(packageDirectory);

		try {
			writeFileSync(join(packageDirectory, "index.js"), "mutated\n", "utf8");
			expect.unreachable("sealed file accepted an in-place write");
		} catch (error: unknown) {
			expect(isErrnoException(error)).toBe(true);

			if (isErrnoException(error)) {
				expect(error.code).toBe(process.platform === "win32" ? "EPERM" : "EACCES");
			}
		}
	});
});

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return typeof error === "object" && error !== null && "code" in error;
}
