import { describe, expect, it } from "vitest";
import { quotedProcessArgumentOf } from "./quotedProcessArgumentOf";

describe("quotedProcessArgumentOf", () => {
	it("wraps a path so Start-Process keeps it as one argument", () => {
		expect(quotedProcessArgumentOf("C:\\Users\\Matt Cavender\\znpm\\shim")).toBe(
			'"C:\\Users\\Matt Cavender\\znpm\\shim"',
		);
	});

	it("escapes embedded double quotes", () => {
		expect(quotedProcessArgumentOf('say "hi"')).toBe('"say \\"hi\\""');
	});
});
