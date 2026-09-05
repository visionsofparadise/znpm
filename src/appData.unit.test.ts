import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { appDirectoryOf, binDirectoryOf, npmWrapperDirectoryOf, npmWrapperPathOf } from "./appData";

describe("appDirectoryOf", () => {
	it("places the Windows app directory under LOCALAPPDATA", () => {
		const env = { LOCALAPPDATA: join("D:", "Users", "someone", "AppData", "Local") };

		expect(appDirectoryOf(env, "win32")).toBe(join("D:", "Users", "someone", "AppData", "Local", "znpm"));
	});

	it("falls back to the user profile when LOCALAPPDATA is unset", () => {
		expect(appDirectoryOf({}, "win32")).toBe(join(homedir(), "AppData", "Local", "znpm"));
	});

	it("places the POSIX app directory under the user's data directory", () => {
		expect(appDirectoryOf({}, "linux")).toBe(join(homedir(), ".local", "share", "znpm"));
	});

	it("takes ZNPM_HOME ahead of every other location on win32", () => {
		const env = {
			ZNPM_HOME: join("D:", "znpm-home"),
			LOCALAPPDATA: join("D:", "Users", "someone", "AppData", "Local"),
			XDG_DATA_HOME: join("D:", "share"),
		};

		expect(appDirectoryOf(env, "win32")).toBe(join("D:", "znpm-home"));
	});

	it("takes ZNPM_HOME ahead of every other location on linux", () => {
		const env = { ZNPM_HOME: join(homedir(), "znpm-home"), XDG_DATA_HOME: join(homedir(), "share") };

		expect(appDirectoryOf(env, "linux")).toBe(join(homedir(), "znpm-home"));
	});

	it("resolves a relative ZNPM_HOME against the working directory", () => {
		expect(appDirectoryOf({ ZNPM_HOME: join("relative", "znpm-home") }, "linux")).toBe(
			resolve(process.cwd(), "relative", "znpm-home"),
		);
	});

	it("places the app directory under XDG_DATA_HOME on linux", () => {
		expect(appDirectoryOf({ XDG_DATA_HOME: join(homedir(), "share") }, "linux")).toBe(
			join(homedir(), "share", "znpm"),
		);
	});

	it("ignores XDG_DATA_HOME on win32", () => {
		const env = { XDG_DATA_HOME: join("D:", "share"), LOCALAPPDATA: join("D:", "Local") };

		expect(appDirectoryOf(env, "win32")).toBe(join("D:", "Local", "znpm"));
	});

	it("falls through an empty ZNPM_HOME and an empty XDG_DATA_HOME", () => {
		expect(appDirectoryOf({ ZNPM_HOME: "", XDG_DATA_HOME: "" }, "linux")).toBe(
			join(homedir(), ".local", "share", "znpm"),
		);
		expect(appDirectoryOf({ ZNPM_HOME: "", LOCALAPPDATA: join("D:", "Local") }, "win32")).toBe(
			join("D:", "Local", "znpm"),
		);
	});
});

describe("the app directory layout", () => {
	it("gives every location its own path under the app directory", () => {
		const appDirectory = "znpm-app";
		const locations = [
			binDirectoryOf(appDirectory),
			npmWrapperDirectoryOf(appDirectory),
			npmWrapperPathOf(appDirectory),
		];

		for (const location of locations) {
			expect(location.startsWith(appDirectory + sep)).toBe(true);
		}

		expect(new Set(locations).size).toBe(locations.length);
	});

	it("names the npm wrapper binary npm inside npm-wrapper", () => {
		expect(basename(npmWrapperPathOf("znpm-app"))).toBe(process.platform === "win32" ? "npm.exe" : "npm");
		expect(basename(dirname(npmWrapperPathOf("znpm-app")))).toBe("npm-wrapper");
	});
});
