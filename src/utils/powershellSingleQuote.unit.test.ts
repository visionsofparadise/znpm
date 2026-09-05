import { describe, expect, it } from "vitest";
import { powershellSingleQuote } from "./powershellSingleQuote";

describe("powershellSingleQuote", () => {
	it("wraps a Windows path", () => {
		expect(powershellSingleQuote("C:\\Users\\Matt Cavender\\AppData\\Local\\znpm\\npm-wrapper")).toBe(
			"'C:\\Users\\Matt Cavender\\AppData\\Local\\znpm\\npm-wrapper'",
		);
	});

	it("doubles an embedded single quote", () => {
		expect(powershellSingleQuote("C:\\Users\\o'brien\\znpm")).toBe("'C:\\Users\\o''brien\\znpm'");
	});
});
