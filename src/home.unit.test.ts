import { homedir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { binDirectoryOf, homeDirectoryOf, shadowPathOf, shimDirectoryOf } from "./home";

describe("homeDirectoryOf", () => {
	const originalLocalAppData = process.env.LOCALAPPDATA;

	afterEach(() => {
		if (originalLocalAppData === undefined) {
			delete process.env.LOCALAPPDATA;
		} else {
			process.env.LOCALAPPDATA = originalLocalAppData;
		}
	});

	it("places the Windows home under LOCALAPPDATA", () => {
		process.env.LOCALAPPDATA = join("D:", "Users", "someone", "AppData", "Local");

		expect(homeDirectoryOf("win32")).toBe(join("D:", "Users", "someone", "AppData", "Local", "znpm"));
	});

	it("falls back to the user profile when LOCALAPPDATA is unset", () => {
		delete process.env.LOCALAPPDATA;

		expect(homeDirectoryOf("win32")).toBe(join(homedir(), "AppData", "Local", "znpm"));
	});

	it("places the POSIX home under the user's data directory", () => {
		expect(homeDirectoryOf("linux")).toBe(join(homedir(), ".local", "share", "znpm"));
	});
});

describe("the home layout", () => {
	it("gives every location its own path under the home", () => {
		const homeDirectory = "znpm-home";
		const locations = [binDirectoryOf(homeDirectory), shimDirectoryOf(homeDirectory), shadowPathOf(homeDirectory)];

		for (const location of locations) {
			expect(location.startsWith(homeDirectory + sep)).toBe(true);
		}

		expect(new Set(locations).size).toBe(locations.length);
	});
});
