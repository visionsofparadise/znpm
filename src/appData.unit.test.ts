import { homedir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appDirectoryOf, binDirectoryOf, npmWrapperPathOf, shimDirectoryOf } from "./appData";

describe("appDirectoryOf", () => {
	const originalLocalAppData = process.env.LOCALAPPDATA;

	afterEach(() => {
		if (originalLocalAppData === undefined) {
			delete process.env.LOCALAPPDATA;
		} else {
			process.env.LOCALAPPDATA = originalLocalAppData;
		}
	});

	it("places the Windows app directory under LOCALAPPDATA", () => {
		process.env.LOCALAPPDATA = join("D:", "Users", "someone", "AppData", "Local");

		expect(appDirectoryOf("win32")).toBe(join("D:", "Users", "someone", "AppData", "Local", "znpm"));
	});

	it("falls back to the user profile when LOCALAPPDATA is unset", () => {
		delete process.env.LOCALAPPDATA;

		expect(appDirectoryOf("win32")).toBe(join(homedir(), "AppData", "Local", "znpm"));
	});

	it("places the POSIX app directory under the user's data directory", () => {
		expect(appDirectoryOf("linux")).toBe(join(homedir(), ".local", "share", "znpm"));
	});
});

describe("the app directory layout", () => {
	it("gives every location its own path under the app directory", () => {
		const appDirectory = "znpm-app";
		const locations = [binDirectoryOf(appDirectory), shimDirectoryOf(appDirectory), npmWrapperPathOf(appDirectory)];

		for (const location of locations) {
			expect(location.startsWith(appDirectory + sep)).toBe(true);
		}

		expect(new Set(locations).size).toBe(locations.length);
	});
});
