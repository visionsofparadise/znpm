import { describe, expect, it } from "vitest";
import { platformPackageOf } from "./platformPackageOf.js";

const supportedTargets = [
	{ platform: "linux", arch: "x64", glibcName: "@zcross/znpm-linux-x64", muslName: "@zcross/znpm-linux-x64-musl" },
	{
		platform: "linux",
		arch: "arm64",
		glibcName: "@zcross/znpm-linux-arm64",
		muslName: "@zcross/znpm-linux-arm64-musl",
	},
	{ platform: "darwin", arch: "x64", glibcName: "@zcross/znpm-darwin-x64", muslName: "@zcross/znpm-darwin-x64" },
	{ platform: "darwin", arch: "arm64", glibcName: "@zcross/znpm-darwin-arm64", muslName: "@zcross/znpm-darwin-arm64" },
	{ platform: "win32", arch: "x64", glibcName: "@zcross/znpm-win32-x64", muslName: "@zcross/znpm-win32-x64" },
	{ platform: "win32", arch: "arm64", glibcName: "@zcross/znpm-win32-arm64", muslName: "@zcross/znpm-win32-arm64" },
];

const unsupportedPairs = [
	["linux", "ia32"],
	["linux", "riscv64"],
	["darwin", "ia32"],
	["win32", "ia32"],
	["freebsd", "x64"],
	["sunos", "x64"],
	["android", "arm64"],
];

describe("platformPackageOf", () => {
	it.each(supportedTargets)("names the package for $platform-$arch", ({ platform, arch, glibcName }) => {
		expect(platformPackageOf(platform, arch, false).name).toBe(glibcName);
	});

	it.each(supportedTargets)("appends -musl on linux alone for $platform-$arch", ({ platform, arch, muslName }) => {
		expect(platformPackageOf(platform, arch, true).name).toBe(muslName);
	});

	it.each(supportedTargets)("names the binary for $platform-$arch", ({ platform, arch }) => {
		expect(platformPackageOf(platform, arch, false).binary).toBe(platform === "win32" ? "znpm.exe" : "znpm");
	});

	it.each(unsupportedPairs)("throws for %s-%s", (platform, arch) => {
		expect(() => platformPackageOf(platform, arch, false)).toThrow(`znpm has no build for ${platform}-${arch}`);
	});

	it("returns the name and the binary alone", () => {
		expect(platformPackageOf("linux", "x64", true)).toEqual({
			name: "@zcross/znpm-linux-x64-musl",
			binary: "znpm",
		});
	});
});
