import { describe, expect, it } from "vitest";
import { environmentPathOf, windowsPathOf } from "./windowsPathOf";

describe("windowsPathOf", () => {
	it("takes an msys path to its windows form", () => {
		expect(windowsPathOf("/c/tmp/znpm")).toBe("C:\\tmp\\znpm");
	});

	it("uppercases the drive letter", () => {
		expect(windowsPathOf("/d/a/b")).toBe("D:\\a\\b");
	});

	it("takes a bare drive to its root", () => {
		expect(windowsPathOf("/c")).toBe("C:\\");
		expect(windowsPathOf("/c/")).toBe("C:\\");
	});

	it("leaves a windows path as it is", () => {
		expect(windowsPathOf("C:\\tmp\\znpm")).toBe("C:\\tmp\\znpm");
	});

	it("leaves a path under a longer root as it is", () => {
		expect(windowsPathOf("/home/someone/znpm")).toBe("/home/someone/znpm");
		expect(windowsPathOf("/cygdrive/c/tmp")).toBe("/cygdrive/c/tmp");
	});

	it("leaves a relative path as it is", () => {
		expect(windowsPathOf("relative/dir")).toBe("relative/dir");
	});

	it("is the inverse of the msys form of a windows path", () => {
		expect(windowsPathOf("/c/Users/someone/AppData/Local/znpm")).toBe("C:\\Users\\someone\\AppData\\Local\\znpm");
	});
});

describe("environmentPathOf", () => {
	it("converts on win32", () => {
		expect(environmentPathOf("/c/tmp/znpm", "win32")).toBe("C:\\tmp\\znpm");
	});

	it("leaves the value alone off win32", () => {
		expect(environmentPathOf("/c/tmp/znpm", "linux")).toBe("/c/tmp/znpm");
	});
});
