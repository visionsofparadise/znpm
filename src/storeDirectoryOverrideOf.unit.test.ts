import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { storeDirectoryOverrideOf } from "./storeDirectoryOverrideOf";

describe("storeDirectoryOverrideOf", () => {
	it("resolves a relative value against the process cwd", () => {
		expect(storeDirectoryOverrideOf({ ZNPM_STORE_DIR: "store" }, process.platform)).toBe(resolve("store"));
	});

	it("returns undefined when the variable is unset or empty", () => {
		expect(storeDirectoryOverrideOf({}, process.platform)).toBeUndefined();
		expect(storeDirectoryOverrideOf({ ZNPM_STORE_DIR: "" }, process.platform)).toBeUndefined();
	});

	it("takes an msys value to its windows form on win32", () => {
		expect(storeDirectoryOverrideOf({ ZNPM_STORE_DIR: "/c/tmp/store" }, "win32")).toBe(resolve("C:\\tmp\\store"));
	});
});
