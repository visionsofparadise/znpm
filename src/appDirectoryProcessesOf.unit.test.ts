import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appDirectoryProcessesOf, isAppDirectoryProcessPath, uninstallBusyMessageOf } from "./appDirectoryProcessesOf";

describe("isAppDirectoryProcessPath", () => {
	it("matches executables under the Windows app directory without regard to case", () => {
		const appDirectory = "C:\\Users\\mttcv\\AppData\\Local\\znpm";

		expect(isAppDirectoryProcessPath(`${appDirectory}\\npm-wrapper\\npm.exe`, appDirectory, "win32")).toBe(true);
		expect(isAppDirectoryProcessPath(`${appDirectory}\\npm-wrapper.exe`, appDirectory, "win32")).toBe(true);
		expect(isAppDirectoryProcessPath(`${appDirectory}\\bin\\znpm.exe`, appDirectory, "win32")).toBe(true);
		expect(
			isAppDirectoryProcessPath(
				"c:\\users\\mttcv\\appdata\\local\\znpm\\npm-wrapper\\npm.exe",
				appDirectory,
				"win32",
			),
		).toBe(true);
	});

	it("leaves a sibling directory unmatched", () => {
		expect(
			isAppDirectoryProcessPath(
				"C:\\Users\\mttcv\\AppData\\Local\\znpm-old\\bin\\znpm.exe",
				"C:\\Users\\mttcv\\AppData\\Local\\znpm",
				"win32",
			),
		).toBe(false);
	});

	it("matches posix executables under the app directory", () => {
		const appDirectory = "/home/matt/.local/share/znpm";

		expect(isAppDirectoryProcessPath(`${appDirectory}/bin/znpm`, appDirectory, "linux")).toBe(true);
		expect(isAppDirectoryProcessPath(`${appDirectory}/npm-wrapper`, appDirectory, "linux")).toBe(true);
		expect(isAppDirectoryProcessPath("/home/matt/.local/share/ZNPM/bin/znpm", appDirectory, "linux")).toBe(false);
	});

	it.skipIf(process.platform === "win32")("matches a symlink whose realpath is inside the app directory", () => {
		const root = mkdtempSync(join(tmpdir(), "znpm-link-"));
		const appDirectory = join(root, "znpm");
		const target = join(appDirectory, "npm-wrapper");
		const link = join(root, "npm");

		try {
			mkdirSync(appDirectory);
			writeFileSync(target, "");
			symlinkSync(target, link);

			expect(isAppDirectoryProcessPath(link, appDirectory, process.platform)).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("appDirectoryProcessesOf", () => {
	const appDirectory = "C:\\Users\\mttcv\\AppData\\Local\\znpm";

	it("drops the current process even when it is the app-directory binary", () => {
		expect(
			appDirectoryProcessesOf([{ pid: 10, path: `${appDirectory}\\bin\\znpm.exe` }], appDirectory, 10, "win32"),
		).toEqual([]);
	});

	it("keeps other app-directory processes and orders them by pid", () => {
		expect(
			appDirectoryProcessesOf(
				[
					{ pid: 40, path: `${appDirectory}\\npm-wrapper\\npm.exe` },
					{ pid: 7, path: "C:\\Program Files\\nodejs\\node.exe" },
					{ pid: 12, path: `${appDirectory}\\npm-wrapper.exe` },
				],
				appDirectory,
				99,
				"win32",
			),
		).toEqual([
			{ pid: 12, path: `${appDirectory}\\npm-wrapper.exe` },
			{ pid: 40, path: `${appDirectory}\\npm-wrapper\\npm.exe` },
		]);
	});

	it("keeps one entry per pid", () => {
		expect(
			appDirectoryProcessesOf(
				[
					{ pid: 40, path: `${appDirectory}\\npm-wrapper\\npm.exe` },
					{ pid: 40, path: `${appDirectory}\\state.json` },
				],
				appDirectory,
				99,
				"win32",
			),
		).toEqual([{ pid: 40, path: `${appDirectory}\\npm-wrapper\\npm.exe` }]);
	});
});

describe("uninstallBusyMessageOf", () => {
	it("states each still-running process on its own line", () => {
		expect(
			uninstallBusyMessageOf([
				{ pid: 25180, path: "C:\\Users\\mttcv\\AppData\\Local\\znpm\\npm-wrapper\\npm.exe" },
				{ pid: 12, path: "C:\\Users\\mttcv\\AppData\\Local\\znpm\\bin\\znpm.exe" },
			]),
		).toBe(
			[
				"znpm uninstall: process 25180 is still running: C:\\Users\\mttcv\\AppData\\Local\\znpm\\npm-wrapper\\npm.exe",
				"znpm uninstall: process 12 is still running: C:\\Users\\mttcv\\AppData\\Local\\znpm\\bin\\znpm.exe",
			].join("\n"),
		);
	});
});
