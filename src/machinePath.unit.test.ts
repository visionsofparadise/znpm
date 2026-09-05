import { describe, expect, it } from "vitest";
import { powershellSingleQuote, powershellStringArray } from "./machinePath";

describe("powershellSingleQuote", () => {
	it("wraps a Windows path", () => {
		expect(powershellSingleQuote("C:\\Users\\Matt Cavender\\AppData\\Local\\znpm\\npm-wrapper")).toBe(
			"'C:\\Users\\Matt Cavender\\AppData\\Local\\znpm\\npm-wrapper'",
		);
	});

	it("doubles an embedded single quote", () => {
		expect(powershellSingleQuote("C:\\Users\\o'brien\\znpm")).toBe("'C:\\Users\\o''brien\\znpm'");
	});

	it("quotes the trailing removal command and each of its arguments separately", () => {
		const trailing = { command: "C:\\Program Files\\nodejs\\npm.cmd", args: ["rm", "-g", "@zcross/znpm"] };

		expect([trailing.command, ...trailing.args].map((value) => powershellSingleQuote(value)).join(" ")).toBe(
			"'C:\\Program Files\\nodejs\\npm.cmd' 'rm' '-g' '@zcross/znpm'",
		);
	});
});

describe("powershellStringArray", () => {
	it("quotes every element for a Start-Process argument list", () => {
		expect(powershellStringArray(["apply-machine-path", "--insert", "C:\\znpm\\npm-wrapper"])).toBe(
			"@('\"apply-machine-path\"','\"--insert\"','\"C:\\znpm\\npm-wrapper\"')",
		);
	});

	it("keeps a spaced path as one argument", () => {
		expect(powershellStringArray(["C:\\Program Files\\znpm"])).toBe("@('\"C:\\Program Files\\znpm\"')");
	});
});
