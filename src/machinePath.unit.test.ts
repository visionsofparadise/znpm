import { describe, expect, it } from "vitest";
import { powershellStringArray, trailingScriptLinesOf } from "./machinePath";

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

describe("trailingScriptLinesOf", () => {
	it("returns no lines without a trailing command", () => {
		expect(trailingScriptLinesOf(undefined)).toEqual([]);
	});

	it("disables znpm and quotes the command and each argument separately", () => {
		expect(
			trailingScriptLinesOf({ command: "C:\\Program Files\\nodejs\\npm.cmd", args: ["rm", "-g", "@zcross/znpm"] }),
		).toEqual(["$env:ZNPM_DISABLE = '1'", "& 'C:\\Program Files\\nodejs\\npm.cmd' 'rm' '-g' '@zcross/znpm'"]);
	});

	it("doubles a single quote inside the command path", () => {
		expect(trailingScriptLinesOf({ command: "C:\\Users\\o'brien\\npm.cmd", args: ["rm"] })).toEqual([
			"$env:ZNPM_DISABLE = '1'",
			"& 'C:\\Users\\o''brien\\npm.cmd' 'rm'",
		]);
	});
});
