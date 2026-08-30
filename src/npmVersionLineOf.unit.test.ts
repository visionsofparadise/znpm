import { describe, expect, it } from "vitest";
import { npmVersionLineOf } from "./npmVersionLineOf";

describe("npmVersionLineOf", () => {
	it("appends (znpm) to npm's version line", () => {
		expect(npmVersionLineOf("11.16.0\n")).toBe("11.16.0 (znpm)\n");
		expect(npmVersionLineOf("11.16.0\r\n")).toBe("11.16.0 (znpm)\n");
		expect(npmVersionLineOf("11.16.0")).toBe("11.16.0 (znpm)\n");
	});

	it("leaves empty stdout unchanged", () => {
		expect(npmVersionLineOf("")).toBe("");
	});
});
