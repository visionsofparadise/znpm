import { describe, expect, it } from "vitest";
import { msysPathOf } from "./msysPathOf";

describe("msysPathOf", () => {
	it("takes a windows path to its msys form", () => {
		expect(msysPathOf("C:\\Users\\x\\znpm")).toBe("/c/Users/x/znpm");
	});

	it("lowercases the drive letter of a forward-slashed path", () => {
		expect(msysPathOf("D:/a/b")).toBe("/d/a/b");
	});

	it("leaves a posix path as it is", () => {
		expect(msysPathOf("/home/x")).toBe("/home/x");
	});

	it("takes the separators of a relative path forward", () => {
		expect(msysPathOf("relative\\dir")).toBe("relative/dir");
	});
});
