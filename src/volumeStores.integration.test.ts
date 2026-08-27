import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { volumeStoreDirectoriesOf } from "./volumeStores";

describe("volumeStoreDirectoriesOf", () => {
	let temporaryRoot: string;
	let pnpmHome: string;
	let storeBase: string;
	let versionThree: string;
	let versionTen: string;

	beforeEach(() => {
		temporaryRoot = mkdtempSync(join(tmpdir(), "znpm-volume-stores-"));
		pnpmHome = join(temporaryRoot, "pnpm-home");
		storeBase = join(pnpmHome, "store");
		versionThree = join(storeBase, "v3");
		versionTen = join(storeBase, "v10");

		mkdirSync(versionThree, { recursive: true });
		mkdirSync(versionTen, { recursive: true });
		mkdirSync(join(storeBase, "v10x"));
		writeFileSync(join(storeBase, "v11"), "not a directory\n", "utf8");
		writeFileSync(join(storeBase, "readme.txt"), "ignore\n", "utf8");
	});

	afterEach(() => {
		rmSync(temporaryRoot, { recursive: true, force: true });
	});

	it("expands existing v* directories under the pnpm home store on every platform", () => {
		const env = { PNPM_HOME: pnpmHome };

		for (const platform of ["win32", "linux", "darwin"] as const) {
			const directories = volumeStoreDirectoriesOf(env, platform);

			expect(directories).toEqual(expect.arrayContaining([versionThree, versionTen]));
			expect(directories).not.toContain(join(storeBase, "v10x"));
			expect(directories).not.toContain(join(storeBase, "v11"));
		}
	});

	it("omits a missing home store base and returns only directories that exist", () => {
		const env = { PNPM_HOME: join(temporaryRoot, "missing-home") };
		const directories = volumeStoreDirectoriesOf(env, process.platform);

		expect(directories).not.toContain(versionThree);
		expect(directories).not.toContain(versionTen);

		for (const directory of directories) {
			expect(existsSync(directory)).toBe(true);
		}
	});

	it("enumerates existing drive-letter .pnpm-store version directories on win32", () => {
		const directories = volumeStoreDirectoriesOf({ PNPM_HOME: pnpmHome }, "win32");
		const expectedVolumeStores = windowsVolumeStoreDirectoriesOf();

		expect(directories).toEqual(expect.arrayContaining([versionThree, versionTen, ...expectedVolumeStores]));

		for (const directory of directories) {
			expect(existsSync(directory)).toBe(true);
		}
	});

	it.skipIf(process.platform !== "linux")("enumerates local rw mount .pnpm-store version directories on linux", () => {
		const directories = volumeStoreDirectoriesOf({ PNPM_HOME: pnpmHome }, "linux");
		const volumeStores = directories.filter((directory) => directory.includes(`${sep}.pnpm-store${sep}`));

		expect(directories).toEqual(expect.arrayContaining([versionThree, versionTen]));

		for (const directory of volumeStores) {
			expect(existsSync(directory)).toBe(true);
			expect(/[/\\]v\d+$/.test(directory)).toBe(true);
		}
	});

	it.skipIf(process.platform !== "darwin")("enumerates /Volumes .pnpm-store version directories on darwin", () => {
		const directories = volumeStoreDirectoriesOf({ PNPM_HOME: pnpmHome }, "darwin");
		const volumeStores = directories.filter((directory) => directory.startsWith(`/Volumes${sep}`));

		expect(directories).toEqual(expect.arrayContaining([versionThree, versionTen]));

		for (const directory of volumeStores) {
			expect(existsSync(directory)).toBe(true);
			expect(/[/\\]v\d+$/.test(directory)).toBe(true);
		}
	});
});

function windowsVolumeStoreDirectoriesOf(): Array<string> {
	const directories: Array<string> = [];

	for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
		const base = join(`${letter}:\\`, ".pnpm-store");

		if (!existsSync(base)) {
			continue;
		}

		for (const entry of readdirSync(base, { withFileTypes: true })) {
			if (entry.isDirectory() && /^v\d+$/.test(entry.name)) {
				directories.push(join(base, entry.name));
			}
		}
	}

	return directories;
}
