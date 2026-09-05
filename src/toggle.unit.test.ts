import { describe, expect, it } from "vitest";
import { type PathChange, type State } from "./appData";
import {
	hasPathEntryIgnoringCase,
	insertPathEntry,
	removeChanges,
	removePathEntry,
	removePathEntryIgnoringCase,
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
		const entry = "/home/someone/.local/share/znpm/npm-wrapper";

		expect(removePathEntry(insertPathEntry(prior, entry, ":"), entry, ":")).toBe(prior);
	});

	it("leaves a value that does not contain the entry", () => {
		expect(removePathEntry("a;b", "c", ";")).toBe("a;b");
	});

	it("leaves an entry spelled in another casing, which is why the machine PATH removal never uses it", () => {
		const pathValue = "C:\\Windows;C:\\ZNPM\\NPM-WRAPPER";

		expect(removePathEntry(pathValue, "C:\\znpm\\npm-wrapper", ";")).toBe(pathValue);
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

describe("hasPathEntryIgnoringCase", () => {
	it("detects an entry spelled in another casing", () => {
		expect(
			hasPathEntryIgnoringCase(
				"C:\\Windows;C:\\USERS\\SOMEONE\\ZNPM\\NPM-WRAPPER",
				"C:\\Users\\Someone\\znpm\\npm-wrapper",
				";",
			),
		).toBe(true);
	});

	it("removes exactly what it detects, so the machine PATH removal cannot report a no-op success", () => {
		const entry = "C:\\Users\\Someone\\AppData\\Local\\znpm\\npm-wrapper";
		const values = [
			`C:\\Windows;${entry.toUpperCase()};C:\\Program Files\\nodejs`,
			`C:\\Windows;${entry};C:\\Program Files\\nodejs`,
			"C:\\Windows;C:\\Program Files\\nodejs",
			"",
		];

		for (const pathValue of values) {
			expect(hasPathEntryIgnoringCase(pathValue, entry, ";")).toBe(
				removePathEntryIgnoringCase(pathValue, entry, ";") !== pathValue,
			);
		}
	});
});

describe("removeChanges", () => {
	it("drops the reversed change and keeps the rest", () => {
		const machine: PathChange = { target: "windowsMachinePath", entry: "C:\\znpm\\shim" };
		const user: PathChange = { target: "windowsUserPath", entry: "C:\\znpm\\bin" };
		const state: State = { enabled: true, disabled: false, changes: [machine, user], npmPath: undefined };

		expect(removeChanges(state, [machine]).changes).toEqual([user]);
	});
});
