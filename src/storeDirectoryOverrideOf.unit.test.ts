import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { storeDirectoryOverrideOf } from "./storeDirectoryOverrideOf";

describe("storeDirectoryOverrideOf", () => {
	it("resolves a relative value against the process cwd", () => {
		expect(storeDirectoryOverrideOf({ ZNPM_STORE_DIR: "store" })).toBe(resolve("store"));
	});

	it("returns undefined when the variable is unset or empty", () => {
		expect(storeDirectoryOverrideOf({})).toBeUndefined();
		expect(storeDirectoryOverrideOf({ ZNPM_STORE_DIR: "" })).toBeUndefined();
	});
});
