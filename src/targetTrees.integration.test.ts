import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { candidateTreeDirectoriesOf, hiddenLockfileStatOf } from "./targetTrees";

describe("candidateTreeDirectoriesOf", () => {
	let temporaryRoot: string;
	let rootProject: string;
	let midProject: string;
	let leafProject: string;
	let emptyLeaf: string;

	beforeEach(() => {
		temporaryRoot = mkdtempSync(join(tmpdir(), "znpm-target-trees-"));
		rootProject = join(temporaryRoot, "root");
		midProject = join(rootProject, "mid");
		leafProject = join(midProject, "leaf");
		emptyLeaf = join(leafProject, "empty");

		mkdirSync(emptyLeaf, { recursive: true });
		mkdirSync(join(midProject, "node_modules"));
		writeFileSync(join(rootProject, "package.json"), "{}\n", "utf8");
		writeFileSync(join(leafProject, "package.json"), "{}\n", "utf8");
	});

	afterEach(() => {
		rmSync(temporaryRoot, { recursive: true, force: true });
	});

	it("walks up from cwd collecting directories that hold package.json or node_modules", () => {
		const candidateTreeDirectories = candidateTreeDirectoriesOf(leafProject, []);

		expect(candidateTreeDirectories.slice(0, 3)).toEqual(
			[leafProject, midProject, rootProject].map((directory) => resolve(directory)),
		);
		expect(candidateTreeDirectories).not.toContain(resolve(emptyLeaf));
	});

	it("includes cwd itself when it qualifies", () => {
		const candidateTreeDirectories = candidateTreeDirectoriesOf(rootProject, []);

		expect(candidateTreeDirectories[0]).toBe(resolve(rootProject));
	});

	it("walks through a cwd that does not itself qualify", () => {
		const candidateTreeDirectories = candidateTreeDirectoriesOf(emptyLeaf, []);

		expect(candidateTreeDirectories.slice(0, 3)).toEqual(
			[leafProject, midProject, rootProject].map((directory) => resolve(directory)),
		);
		expect(candidateTreeDirectories).not.toContain(resolve(emptyLeaf));
	});

	it("includes --prefix and -C values for both separators, resolved against cwd", () => {
		const bySpacePrefix = join(temporaryRoot, "by-space-prefix");
		const byEqualsPrefix = join(temporaryRoot, "by-equals-prefix");
		const bySpaceC = join(temporaryRoot, "nested", "by-space-c");
		const byEqualsC = join(temporaryRoot, "nested", "by-equals-c");

		mkdirSync(bySpacePrefix);
		mkdirSync(byEqualsPrefix);
		mkdirSync(bySpaceC, { recursive: true });
		mkdirSync(byEqualsC, { recursive: true });

		const candidateTreeDirectories = candidateTreeDirectoriesOf(rootProject, [
			"--prefix",
			join("..", "by-space-prefix"),
			`--prefix=${byEqualsPrefix}`,
			"-C",
			join("..", "nested", "by-space-c"),
			`-C=${join("..", "nested", "by-equals-c")}`,
		]);

		expect(candidateTreeDirectories).toEqual(
			expect.arrayContaining([
				resolve(bySpacePrefix),
				resolve(byEqualsPrefix),
				resolve(bySpaceC),
				resolve(byEqualsC),
			]),
		);
	});

	it("deduplicates the walk-up chain and a prefix that resolve to the same directory", () => {
		const candidateTreeDirectories = candidateTreeDirectoriesOf(leafProject, [
			"--prefix",
			".",
			"-C",
			leafProject,
			`--prefix=${midProject}`,
		]);
		const resolvedLeaf = resolve(leafProject);
		const resolvedMid = resolve(midProject);
		const matchingLeaf = candidateTreeDirectories.filter(
			(candidateTreeDirectory) => identityKeyOf(candidateTreeDirectory) === identityKeyOf(resolvedLeaf),
		);
		const matchingMid = candidateTreeDirectories.filter(
			(candidateTreeDirectory) => identityKeyOf(candidateTreeDirectory) === identityKeyOf(resolvedMid),
		);

		expect(matchingLeaf).toHaveLength(1);
		expect(matchingMid).toHaveLength(1);
	});

	it.skipIf(process.platform !== "win32")("deduplicates by resolved path case-insensitively", () => {
		const candidateTreeDirectories = candidateTreeDirectoriesOf(leafProject, ["--prefix", leafProject.toUpperCase()]);
		const matching = candidateTreeDirectories.filter(
			(candidateTreeDirectory) => identityKeyOf(candidateTreeDirectory) === identityKeyOf(resolve(leafProject)),
		);

		expect(matching).toHaveLength(1);
	});
});

describe("hiddenLockfileStatOf", () => {
	let temporaryRoot: string;

	beforeEach(() => {
		temporaryRoot = mkdtempSync(join(tmpdir(), "znpm-hidden-lockfile-stat-"));
	});

	afterEach(() => {
		rmSync(temporaryRoot, { recursive: true, force: true });
	});

	it("returns undefined when the hidden lockfile is absent", () => {
		expect(hiddenLockfileStatOf(temporaryRoot)).toBeUndefined();
	});

	it("returns mtimeMs and size when the hidden lockfile is present", () => {
		const body = '{"lockfileVersion": 3}\n';

		mkdirSync(join(temporaryRoot, "node_modules"));
		writeFileSync(join(temporaryRoot, "node_modules", ".package-lock.json"), body, "utf8");

		const stats = hiddenLockfileStatOf(temporaryRoot);

		expect(stats).toEqual({ mtimeMs: expect.any(Number), size: Buffer.byteLength(body) });
	});
});

function identityKeyOf(path: string): string {
	return process.platform === "win32" ? path.toLowerCase() : path;
}
