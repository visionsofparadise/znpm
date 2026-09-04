import { describe, expect, it } from "vitest";
import { type PathChange, type State } from "./appData";
import {
	changesToReverseOf,
	insertPathEntry,
	isSymlinkPointingAt,
	removePathEntry,
	removePathEntryIgnoringCase,
	upsertChange,
	type PosixSymlinkInspection,
} from "./toggle";

describe("insertPathEntry", () => {
	it("prepends the entry", () => {
		expect(insertPathEntry("b;c", "a", ";")).toBe("a;b;c");
	});

	it("is idempotent when the entry is already present", () => {
		expect(insertPathEntry("a;b;c", "a", ";")).toBe("a;b;c");
		expect(insertPathEntry("b;a;c", "a", ";")).toBe("b;a;c");
	});

	it("inserts into an empty value", () => {
		expect(insertPathEntry("", "a", ";")).toBe("a");
	});

	it("uses the given separator", () => {
		expect(insertPathEntry("b:c", "a", ":")).toBe("a:b:c");
		expect(insertPathEntry("a:b:c", "a", ":")).toBe("a:b:c");
	});
});

describe("removePathEntry", () => {
	it("restores the prior value after an insert", () => {
		const prior = "b;c;d";

		expect(removePathEntry(insertPathEntry(prior, "a", ";"), "a", ";")).toBe(prior);
	});

	it("restores the prior value with a colon separator", () => {
		const prior = "/usr/bin:/bin";

		expect(removePathEntry(insertPathEntry(prior, "/usr/local/bin", ":"), "/usr/local/bin", ":")).toBe(prior);
	});

	it("leaves a value that does not contain the entry", () => {
		expect(removePathEntry("a;b", "c", ";")).toBe("a;b");
	});
});

describe("removePathEntryIgnoringCase", () => {
	it("removes an entry recorded in another casing", () => {
		expect(
			removePathEntryIgnoringCase(
				"C:\\Users\\Someone\\AppData\\Local\\znpm\\bin;C:\\Windows",
				"c:\\users\\someone\\appdata\\local\\znpm\\bin",
				";",
			),
		).toBe("C:\\Windows");
	});

	it("removes an entry spelled exactly", () => {
		expect(removePathEntryIgnoringCase("C:\\znpm\\bin;C:\\Windows", "C:\\znpm\\bin", ";")).toBe("C:\\Windows");
	});

	it("removes every occurrence of the entry", () => {
		expect(removePathEntryIgnoringCase("C:\\znpm\\bin;C:\\Windows;c:\\ZNPM\\BIN", "C:\\znpm\\bin", ";")).toBe(
			"C:\\Windows",
		);
	});

	it("leaves a value that does not contain the entry", () => {
		expect(removePathEntryIgnoringCase("C:\\Windows;C:\\znpm\\shim", "C:\\znpm\\bin", ";")).toBe(
			"C:\\Windows;C:\\znpm\\shim",
		);
	});

	it("leaves an empty value empty", () => {
		expect(removePathEntryIgnoringCase("", "C:\\znpm\\bin", ";")).toBe("");
	});
});

describe("isSymlinkPointingAt", () => {
	const targetPath = "/home/someone/.local/share/znpm/bin/znpm";
	const inspectionOf = (inspection: Partial<PosixSymlinkInspection>): PosixSymlinkInspection => ({
		exists: true,
		isSymbolicLink: true,
		linkTargetPath: undefined,
		resolvedLinkPath: undefined,
		...inspection,
	});

	it("accepts a symlink whose recorded target is the znpm binary", () => {
		expect(isSymlinkPointingAt(inspectionOf({ linkTargetPath: targetPath }), targetPath, targetPath)).toBe(true);
	});

	it("accepts a symlink that resolves to the znpm binary through another link", () => {
		expect(
			isSymlinkPointingAt(
				inspectionOf({ linkTargetPath: "../share/znpm/bin/znpm", resolvedLinkPath: targetPath }),
				targetPath,
				targetPath,
			),
		).toBe(true);
	});

	it("refuses a symlink pointing somewhere else", () => {
		expect(
			isSymlinkPointingAt(
				inspectionOf({ linkTargetPath: "/opt/other/znpm", resolvedLinkPath: "/opt/other/znpm" }),
				targetPath,
				targetPath,
			),
		).toBe(false);
	});

	it("refuses a regular file standing where the symlink would be", () => {
		expect(isSymlinkPointingAt(inspectionOf({ isSymbolicLink: false }), targetPath, targetPath)).toBe(false);
	});

	it("refuses an absent entry", () => {
		expect(isSymlinkPointingAt(inspectionOf({ exists: false, isSymbolicLink: false }), targetPath, targetPath)).toBe(
			false,
		);
	});

	it("refuses a dangling symlink whose target cannot be resolved", () => {
		expect(isSymlinkPointingAt(inspectionOf({ linkTargetPath: "/opt/other/znpm" }), targetPath, undefined)).toBe(
			false,
		);
	});
});

describe("changesToReverseOf", () => {
	const changes: Array<PathChange> = [
		{ target: "windowsMachinePath", entry: "C:\\znpm\\shim" },
		{ target: "windowsUserPath", entry: "C:\\znpm\\bin" },
		{ target: "posixSymlink", path: "/usr/local/bin/npm" },
		{ target: "posixSymlink", path: "/usr/local/bin/znpm" },
	];

	it("selects the npm-facing entries for disable", () => {
		expect(changesToReverseOf(changes, "disable")).toEqual([
			{ target: "windowsMachinePath", entry: "C:\\znpm\\shim" },
			{ target: "posixSymlink", path: "/usr/local/bin/npm" },
		]);
	});

	it("selects every entry for uninstall", () => {
		expect(changesToReverseOf(changes, "uninstall")).toEqual(changes);
	});
});

describe("upsertChange", () => {
	it("leaves changes duplicate-free on repeat enable", () => {
		const empty: State = { enabled: false, disabled: false, changes: [], npmPath: undefined };
		const machine: PathChange = { target: "windowsMachinePath", entry: "C:\\znpm\\shim" };
		const user: PathChange = { target: "windowsUserPath", entry: "C:\\znpm\\bin" };
		const once = upsertChange(upsertChange(empty, machine), user);
		const twice = upsertChange(upsertChange(once, machine), user);

		expect(twice.changes).toEqual([machine, user]);
	});
});
