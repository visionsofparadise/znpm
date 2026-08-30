import { describe, expect, it } from "vitest";
import { npmVersionLineOf } from "./npmVersionLineOf";

describe("npmVersionLineOf", () => {
	it("appends (znpm <version>) to npm's version line", () => {
		expect(npmVersionLineOf("11.16.0\n", "0.2.1")).toBe("11.16.0 (znpm 0.2.1)\n");
		expect(npmVersionLineOf("11.16.0\r\n", "0.2.1")).toBe("11.16.0 (znpm 0.2.1)\n");
		expect(npmVersionLineOf("11.16.0", "0.2.1")).toBe("11.16.0 (znpm 0.2.1)\n");
	});

	it("leaves empty stdout unchanged", () => {
		expect(npmVersionLineOf("", "0.2.1")).toBe("");
	});
});
