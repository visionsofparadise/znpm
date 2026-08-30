import { describe, expect, it } from "vitest";
import { isNpmVersionQuery } from "./isNpmVersionQuery";

describe("isNpmVersionQuery", () => {
	it("matches npm -v and npm --version", () => {
		expect(isNpmVersionQuery(["-v"])).toBe(true);
		expect(isNpmVersionQuery(["--version"])).toBe(true);
	});

	it("rejects commands that are not a version query", () => {
		expect(isNpmVersionQuery(["install"])).toBe(false);
		expect(isNpmVersionQuery(["version"])).toBe(false);
		expect(isNpmVersionQuery(["install", "--version"])).toBe(false);
		expect(isNpmVersionQuery([])).toBe(false);
	});
});
