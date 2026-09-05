import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { isPathUnder } from "./isPathUnder";

describe("isPathUnder", () => {
	const directory = resolve(join(sep, "app", "znpm"));

	it("holds for a descendant", () => {
		expect(isPathUnder(join(directory, "bin", "znpm.exe"), directory)).toBe(true);
	});

	it("holds through a non-normalized path", () => {
		expect(isPathUnder(join(directory, ".", "bin", "..", "bin", "znpm.exe"), directory)).toBe(true);
	});

	it("fails for the directory itself", () => {
		expect(isPathUnder(directory, directory)).toBe(false);
	});

	it("fails for a sibling whose name extends the directory's", () => {
		expect(isPathUnder(`${directory}-other${sep}znpm.exe`, directory)).toBe(false);
	});

	it("fails for an ancestor", () => {
		expect(isPathUnder(resolve(join(sep, "app")), directory)).toBe(false);
	});

	it.runIf(process.platform === "win32")("ignores case on win32", () => {
		expect(isPathUnder(join(directory.toUpperCase(), "bin", "znpm.exe"), directory)).toBe(true);
	});
});
