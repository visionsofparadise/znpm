import { chmodSync, linkSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detachPackageDirectory } from "./detach";

describe("detachPackageDirectory", () => {
	let temporaryRoot: string;
	let packageDirectory: string;
	let storeFilePath: string;

	beforeEach(() => {
		temporaryRoot = mkdtempSync(join(tmpdir(), "znpm-detach-"));
		packageDirectory = join(temporaryRoot, "package");
		storeFilePath = join(temporaryRoot, "store-file.js");
		mkdirSync(packageDirectory);
		writeFileSync(storeFilePath, "shared\n", "utf8");
		linkSync(storeFilePath, join(packageDirectory, "shared.js"));
		writeFileSync(join(packageDirectory, "private.js"), "private\n", "utf8");
		chmodSync(join(packageDirectory, "private.js"), 0o444);
		mkdirSync(join(packageDirectory, "node_modules", "nested"), { recursive: true });
		linkSync(storeFilePath, join(packageDirectory, "node_modules", "nested", "still-shared.js"));
	});

	afterEach(() => {
		rmSync(temporaryRoot, { recursive: true, force: true });
	});

	it("gives a shared file nlink 1 and mode 0o666, chmods unshared files in place, and stops at nested node_modules", () => {
		expect(statSync(join(packageDirectory, "shared.js")).nlink).toBeGreaterThanOrEqual(2);

		const detachedFiles = detachPackageDirectory(packageDirectory);
		const sharedStat = statSync(join(packageDirectory, "shared.js"));
		const privateStat = statSync(join(packageDirectory, "private.js"));
		const nestedStat = statSync(join(packageDirectory, "node_modules", "nested", "still-shared.js"));
		const storeStat = statSync(storeFilePath);

		expect(detachedFiles).toBe(1);
		expect(sharedStat.nlink).toBe(1);
		expect(sharedStat.mode & 0o777).toBe(0o666);
		expect(sharedStat.ino).not.toBe(storeStat.ino);
		expect(privateStat.nlink).toBe(1);
		expect(privateStat.mode & 0o777).toBe(0o666);
		expect(nestedStat.nlink).toBeGreaterThanOrEqual(2);
		expect(nestedStat.ino).toBe(storeStat.ino);
	});
});
