import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pnpmHomeDirectoryOf } from "./pnpmHome";

describe("pnpmHomeDirectoryOf", () => {
	it("prefers PNPM_HOME", () => {
		expect(pnpmHomeDirectoryOf({ PNPM_HOME: join("D:", "pnpm") }, "win32")).toBe(join("D:", "pnpm"));
		expect(pnpmHomeDirectoryOf({ PNPM_HOME: "/opt/pnpm" }, "linux")).toBe("/opt/pnpm");
	});

	it("uses LOCALAPPDATA\\pnpm on Windows", () => {
		expect(pnpmHomeDirectoryOf({ LOCALAPPDATA: join("D:", "Users", "someone", "AppData", "Local") }, "win32")).toBe(
			join("D:", "Users", "someone", "AppData", "Local", "pnpm"),
		);
	});

	it("uses ~/Library/pnpm on darwin", () => {
		expect(pnpmHomeDirectoryOf({}, "darwin")).toBe(join(homedir(), "Library", "pnpm"));
	});

	it("uses XDG_DATA_HOME/pnpm on Linux when set", () => {
		expect(pnpmHomeDirectoryOf({ XDG_DATA_HOME: "/var/data" }, "linux")).toBe(join("/var/data", "pnpm"));
	});

	it("uses ~/.local/share/pnpm on Linux otherwise", () => {
		expect(pnpmHomeDirectoryOf({}, "linux")).toBe(join(homedir(), ".local", "share", "pnpm"));
	});
});
