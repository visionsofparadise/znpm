import { describe, expect, it } from "vitest";
import { changesToReverseOf, insertPathEntry, removePathEntry, upsertChange } from "./enablement";
import { type PathChange, type State } from "./home";

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
		const empty: State = { enabled: false, changes: [], realNpmPath: undefined };
		const machine: PathChange = { target: "windowsMachinePath", entry: "C:\\znpm\\shim" };
		const user: PathChange = { target: "windowsUserPath", entry: "C:\\znpm\\bin" };
		const once = upsertChange(upsertChange(empty, machine), user);
		const twice = upsertChange(upsertChange(once, machine), user);

		expect(twice.changes).toEqual([machine, user]);
	});
});
