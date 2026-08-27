import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cacacheTarballPathOf, npmCacheDirectoryOf } from "./npmCache";

describe("npmCacheDirectoryOf", () => {
	it("prefers npm_config_cache", () => {
		expect(npmCacheDirectoryOf({ npm_config_cache: join("D:", "cache") }, "win32")).toBe(join("D:", "cache"));
		expect(npmCacheDirectoryOf({ npm_config_cache: "/tmp/cache" }, "linux")).toBe("/tmp/cache");
	});

	it("uses LOCALAPPDATA\\npm-cache on Windows", () => {
		expect(npmCacheDirectoryOf({ LOCALAPPDATA: join("D:", "Users", "someone", "AppData", "Local") }, "win32")).toBe(
			join("D:", "Users", "someone", "AppData", "Local", "npm-cache"),
		);
	});

	it("uses ~/.npm on POSIX", () => {
		expect(npmCacheDirectoryOf({}, "linux")).toBe(join(homedir(), ".npm"));
	});
});

describe("cacacheTarballPathOf", () => {
	const digest = Buffer.alloc(64, 0xab);
	const sha512Member = `sha512-${digest.toString("base64")}`;
	const hex = digest.toString("hex");
	const cacheDirectory = join("D:", "cache");

	it("picks the sha512 member of a multi-member integrity string", () => {
		expect(cacacheTarballPathOf(cacheDirectory, `sha1-deadbeef ${sha512Member}`)).toBe(
			join(cacheDirectory, "_cacache", "content-v2", "sha512", hex.slice(0, 2), hex.slice(2, 4), hex.slice(4)),
		);
	});

	it("yields undefined for sha1-only integrity", () => {
		expect(cacacheTarballPathOf(cacheDirectory, "sha1-deadbeef")).toBeUndefined();
	});

	it("derives the content-v2 path from the sha512 digest hex", () => {
		expect(hex.slice(0, 4)).toBe("abab");
		expect(cacacheTarballPathOf(cacheDirectory, sha512Member)).toBe(
			join(cacheDirectory, "_cacache", "content-v2", "sha512", "ab", "ab", hex.slice(4)),
		);
	});
});
