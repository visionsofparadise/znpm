import { describe, expect, it } from "vitest";
import { powershellStringArray } from "./machinePath";

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
