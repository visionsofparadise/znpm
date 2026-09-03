import { describe, expect, it } from "vitest";
import { unlinkedLineOf } from "./unlinkedLineOf";

describe("unlinkedLineOf", () => {
	it("reports one package in the singular and many in the plural", () => {
		expect(unlinkedLineOf(1)).toBe("znpm: 1 package not linked to the store; node_modules is unaffected");
		expect(unlinkedLineOf(2)).toBe("znpm: 2 packages not linked to the store; node_modules is unaffected");
	});
});
