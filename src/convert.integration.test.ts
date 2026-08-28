import { spawnSync } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { restartWorkerPool } from "@pnpm/worker";
import { afterEach, describe, expect, it } from "vitest";
import { appDirectoryOf } from "./appData";
import { convert, type ConvertSummary } from "./convert";
import { readHiddenLockfile, wantedPackagesOf } from "./hiddenLockfile";
import { resolveNpm } from "./npm";
import { cacacheTarballPathOf } from "./npmCache";
import { pruneStoreDirectories } from "./prune";

interface Workspace {
	root: string;
	store: string;
	cache: string;
	pnpmAppDirectory: string;
}

describe("convert", { timeout: 180_000 }, () => {
	const workspaces: Array<string> = [];

	afterEach(async () => {
		await restartWorkerPool();

		for (const root of workspaces.splice(0)) {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("(a) store-links a fresh fixture, seals files, stays require-able, and shares inodes", async () => {
		const workspace = openWorkspace();
		const first = writeFixture(workspace, "first", { ms: "2.1.3" });
		const second = writeFixture(workspace, "second", { ms: "2.1.3" });

		runNpm(first, ["install"], workspace);

		const summary = await convertProject(first, workspace);
		const firstManifest = join(first, "node_modules", "ms", "package.json");
		const required = createRequire(join(first, "package.json"));

		expect(summary.failed).toBe(0);
		expect(summary.imported).toBeGreaterThan(0);
		expect(statSync(firstManifest).nlink).toBeGreaterThan(1);
		expect(statSync(firstManifest).mode & 0o777).toBe(0o444);
		expect(typeof required("ms")).toBe("function");
		expect(required("ms")("1s")).toBe(1000);

		runNpm(second, ["install"], workspace);
		await convertProject(second, workspace);

		const secondManifest = join(second, "node_modules", "ms", "package.json");

		expect(statSync(secondManifest).nlink).toBeGreaterThan(1);
		expect(statSync(secondManifest).ino).toBe(statSync(firstManifest).ino);
	});

	it("(b) npm install over a converted tree reports up to date and touches no files", async () => {
		const workspace = openWorkspace();
		const fixture = writeFixture(workspace, "fixture", { ms: "2.1.3" });

		runNpm(fixture, ["install"], workspace);
		await convertProject(fixture, workspace);

		const before = inodeWalkOf(join(fixture, "node_modules"));
		const result = runNpm(fixture, ["install"], workspace);
		const after = inodeWalkOf(join(fixture, "node_modules"));

		expect(`${result.stdout}\n${result.stderr}`).toMatch(/up to date/i);
		expect(after).toEqual(before);
	});

	it("(c) package.json and package-lock.json stay byte-identical to a raw-npm twin", async () => {
		const workspace = openWorkspace();
		const converted = writeFixture(workspace, "converted", { ms: "2.1.3" });
		const control = writeFixture(workspace, "control", { ms: "2.1.3" });

		runNpm(converted, ["install"], workspace);
		runNpm(control, ["install"], workspace);
		await convertProject(converted, workspace);

		expect(readFileSync(join(converted, "package.json"))).toEqual(readFileSync(join(control, "package.json")));
		expect(readFileSync(join(converted, "package-lock.json"))).toEqual(
			readFileSync(join(control, "package-lock.json")),
		);
	});

	it("(d) a file: dependency stays a symlink", async () => {
		const workspace = openWorkspace();
		const localDependency = join(workspace.root, "local-dep");

		mkdirSync(localDependency);
		writeFileSync(
			join(localDependency, "package.json"),
			`${JSON.stringify({ name: "local-dep", version: "1.0.0" }, undefined, "\t")}\n`,
			"utf8",
		);
		writeFileSync(join(localDependency, "index.js"), "module.exports = 1\n", "utf8");

		const fixture = writeFixture(workspace, "fixture", { "local-dep": "file:../local-dep" });

		runNpm(fixture, ["install"], workspace);

		const linkedPath = join(fixture, "node_modules", "local-dep");

		expect(lstatSync(linkedPath).isSymbolicLink()).toBe(true);

		const summary = await convertProject(fixture, workspace);

		expect(lstatSync(linkedPath).isSymbolicLink()).toBe(true);
		expect(summary.symlinked + summary.notATarball).toBeGreaterThan(0);
		expect(summary.imported).toBe(0);
	});

	it("(e) a self-building package keeps its script-written marker and stays unconverted", async () => {
		const workspace = openWorkspace();
		const repo = join(workspace.root, "self-building");

		mkdirSync(repo);
		writeFileSync(
			join(repo, "package.json"),
			`${JSON.stringify(
				{
					name: "self-building-fixture",
					version: "1.0.0",
					scripts: {
						postinstall: "node -e \"require('fs').writeFileSync('marker.txt', 'built')\"",
					},
				},
				undefined,
				"\t",
			)}\n`,
			"utf8",
		);
		writeFileSync(join(repo, "index.js"), "module.exports = 1\n", "utf8");
		runGit(repo, ["init"]);
		runGit(repo, ["add", "."]);
		runGit(repo, ["-c", "user.email=znpm@test", "-c", "user.name=znpm", "commit", "-m", "init"]);

		const commit = runGit(repo, ["rev-parse", "HEAD"]).stdout.trim();
		const fixture = join(workspace.root, "fixture");
		const gitSpecifier = `git+file://${repo.replaceAll("\\", "/")}#${commit}`;

		mkdirSync(fixture);
		writeFileSync(join(fixture, ".npmrc"), `cache=${workspace.cache.replaceAll("\\", "/")}\nallow-git=all\n`, "utf8");
		writeFileSync(
			join(fixture, "package.json"),
			`${JSON.stringify(
				{
					name: "self-building-host",
					private: true,
					dependencies: {
						"self-building-fixture": gitSpecifier,
					},
					allowScripts: {
						"self-building-fixture@1.0.0": true,
					},
				},
				undefined,
				"\t",
			)}\n`,
			"utf8",
		);

		runNpm(fixture, ["install"], workspace);

		const installed = join(fixture, "node_modules", "self-building-fixture");
		const markerPath = join(installed, "marker.txt");

		expect(readFileSync(markerPath, "utf8")).toBe("built");

		const nlinkBefore = statSync(join(installed, "package.json")).nlink;
		const summary = await convertProject(fixture, workspace);

		expect(summary.selfBuilding).toBe(1);
		expect(summary.imported).toBe(0);
		expect(readFileSync(markerPath, "utf8")).toBe("built");
		expect(statSync(join(installed, "package.json")).nlink).toBe(nlinkBefore);
	});

	it("(f) znpm.ignore detaches the named package and leaves nested node_modules shared", async () => {
		const workspace = openWorkspace();
		const dependencies = {
			"brace-expansion": "1.1.11",
			"balanced-match": "0.4.2",
		};
		const fixture = writeFixture(workspace, "fixture", dependencies);

		runNpm(fixture, ["install"], workspace);
		await convertProject(fixture, workspace);

		const ignoredManifest = join(fixture, "node_modules", "brace-expansion", "package.json");
		const nestedManifest = join(
			fixture,
			"node_modules",
			"brace-expansion",
			"node_modules",
			"balanced-match",
			"package.json",
		);

		expect(existsSync(nestedManifest)).toBe(true);
		expect(statSync(ignoredManifest).nlink).toBeGreaterThan(1);

		writeFileSync(
			join(fixture, "package.json"),
			`${JSON.stringify(
				{
					name: "znpm-fixture",
					private: true,
					dependencies,
					znpm: { ignore: ["brace-expansion"] },
				},
				undefined,
				"\t",
			)}\n`,
			"utf8",
		);

		const summary = await convertProject(fixture, workspace);

		expect(summary.ignored).toBe(1);
		expect(summary.detachedFiles).toBeGreaterThan(0);
		expect(statSync(ignoredManifest).nlink).toBe(1);
		expect(statSync(ignoredManifest).mode & 0o777).toBe(0o666);
		expect(statSync(nestedManifest).nlink).toBeGreaterThan(1);
	});

	it("(g) a lockfile-only version bump counts stale and leaves npm's tree, then a real install converts", async () => {
		const workspace = openWorkspace();
		const fixture = writeFixture(workspace, "fixture", { ms: "2.1.1" });

		runNpm(fixture, ["install"], workspace);
		writeFixtureManifest(fixture, { ms: "2.1.3" });
		runNpm(fixture, ["install", "--package-lock-only"], workspace);

		const before = treeBytesOf(join(fixture, "node_modules"));
		const staleSummary = await convertProject(fixture, workspace);

		expect(staleSummary.stale).toBeGreaterThan(0);
		expect(staleSummary.imported).toBe(0);
		expect(treeBytesOf(join(fixture, "node_modules"))).toEqual(before);

		rmSync(join(fixture, "node_modules", ".package-lock.json"), { force: true });
		runNpm(fixture, ["install"], workspace);
		expect(JSON.parse(readFileSync(join(fixture, "node_modules", "ms", "package.json"), "utf8")).version).toBe(
			"2.1.3",
		);

		const converted = await convertProject(fixture, workspace);

		expect(converted.stale).toBe(0);
		expect(converted.imported).toBeGreaterThan(0);
		expect(statSync(join(fixture, "node_modules", "ms", "package.json")).nlink).toBeGreaterThan(1);
	});

	describe("cacache sourcing", () => {
		it("converts from a temp npm cache with cacheMisses 0", async () => {
			const workspace = openWorkspace();
			const fixture = writeFixture(workspace, "fixture", { ms: "2.1.3", abbrev: "3.0.1" });

			runNpm(fixture, ["install"], workspace);

			const summary = await convertProject(fixture, workspace);

			expect(summary.cacheMisses).toBe(0);
			expect(summary.failed).toBe(0);
			expect(summary.imported).toBeGreaterThan(0);
		});

		it("counts a renamed cacache entry as a cache miss and still imports through resolved", async () => {
			const workspace = openWorkspace();
			const fixture = writeFixture(workspace, "fixture", { ms: "2.1.3", abbrev: "3.0.1" });

			runNpm(fixture, ["install"], workspace);

			const victim = tarballWantedPackageOf(fixture, "abbrev");
			const cacachePath = cacacheTarballPathOf(workspace.cache, victim.integrity);

			expect(cacachePath).toBeDefined();

			if (cacachePath !== undefined) {
				renameSync(cacachePath, `${cacachePath}.away`);
			}

			const freshStore = join(workspace.root, "store-miss");
			const summary = await convert(fixture, {
				storeDirectory: freshStore,
				pnpmAppDirectory: workspace.pnpmAppDirectory,
				npmCacheDirectory: workspace.cache,
			});

			expect(summary.cacheMisses).toBe(1);
			expect(summary.failed).toBe(0);
			expect(summary.imported).toBeGreaterThan(0);
			expect(statSync(join(fixture, "node_modules", "abbrev", "package.json")).nlink).toBeGreaterThan(1);
		});

		it("counts an in-place corrupt cached tarball as failed, not a miss", async () => {
			const workspace = openWorkspace();
			const fixture = writeFixture(workspace, "fixture", { ms: "2.1.3", abbrev: "3.0.1" });

			runNpm(fixture, ["install"], workspace);

			const victim = tarballWantedPackageOf(fixture, "abbrev");
			const cacachePath = cacacheTarballPathOf(workspace.cache, victim.integrity);

			expect(cacachePath).toBeDefined();

			if (cacachePath !== undefined) {
				const original = readFileSync(cacachePath);
				const corrupted = Buffer.from(original);
				const index = Math.min(20, Math.max(0, corrupted.length - 1));

				corrupted.writeUInt8(corrupted.readUInt8(index) ^ 0xff, index);
				writeFileSync(cacachePath, corrupted);
			}

			const freshStore = join(workspace.root, "store-corrupt");
			const summary = await convert(fixture, {
				storeDirectory: freshStore,
				pnpmAppDirectory: workspace.pnpmAppDirectory,
				npmCacheDirectory: workspace.cache,
			});
			const abbrevManifest = join(fixture, "node_modules", "abbrev", "package.json");

			expect(summary.cacheMisses).toBe(0);
			expect(summary.failed).toBe(1);
			expect(statSync(abbrevManifest).nlink).toBe(1);
			expect(JSON.parse(readFileSync(abbrevManifest, "utf8")).version).toBe(victim.version);
		});
	});

	it("(i) a missing hidden lockfile exits cleanly converting nothing", async () => {
		const workspace = openWorkspace();
		const fixture = writeFixture(workspace, "fixture", { ms: "2.1.3" });
		const summary = await convertProject(fixture, workspace);

		expect(summary.entries).toBe(0);
		expect(summary.imported).toBe(0);
		expect(summary.failed).toBe(0);
		expect(existsSync(join(fixture, "node_modules"))).toBe(false);
	});

	it("(j) two fixtures converting concurrently into one empty store share inodes with zero failures", async () => {
		const workspace = openWorkspace();
		const first = writeFixture(workspace, "first", { ms: "2.1.3" });
		const second = writeFixture(workspace, "second", { ms: "2.1.3" });

		runNpm(first, ["install"], workspace);
		runNpm(second, ["install"], workspace);

		const [firstSummary, secondSummary] = await Promise.all([
			convertProject(first, workspace),
			convertProject(second, workspace),
		]);

		expect(firstSummary.failed).toBe(0);
		expect(secondSummary.failed).toBe(0);
		expect(statSync(join(first, "node_modules", "ms", "package.json")).ino).toBe(
			statSync(join(second, "node_modules", "ms", "package.json")).ino,
		);
	});

	it("(k) prune removes a deleted project's unshared files and spares the survivor", async () => {
		const workspace = openWorkspace();
		const first = writeFixture(workspace, "first", { ms: "2.1.3", abbrev: "3.0.1" });
		const second = writeFixture(workspace, "second", { ms: "2.1.3" });

		runNpm(first, ["install"], workspace);
		runNpm(second, ["install"], workspace);

		const firstSummary = await convertProject(first, workspace);
		await convertProject(second, workspace);

		const survivorManifest = join(second, "node_modules", "ms", "package.json");
		const survivorIno = statSync(survivorManifest).ino;
		const storeFileCountBefore = fileCountOf(firstSummary.storeDirectory);

		rmSync(first, { recursive: true, force: true });
		await pruneStoreDirectories([firstSummary.storeDirectory]);

		expect(fileCountOf(firstSummary.storeDirectory)).toBeLessThan(storeFileCountBefore);
		expect(statSync(survivorManifest).ino).toBe(survivorIno);
		expect(statSync(survivorManifest).nlink).toBeGreaterThan(1);
	});

	it("(l) a bundled-dependency package keeps bundled children intact and linked", async () => {
		const workspace = openWorkspace();
		const fixture = writeFixture(workspace, "fixture", {
			"@aws-cdk/cloud-assembly-schema": "38.0.1",
		});

		runNpm(fixture, ["install"], workspace);

		const parent = join(fixture, "node_modules", "@aws-cdk", "cloud-assembly-schema");
		const bundledChild = join(parent, "node_modules", "jsonschema", "package.json");

		expect(existsSync(bundledChild)).toBe(true);

		const summary = await convertProject(fixture, workspace);
		const required = createRequire(join(fixture, "package.json"));

		expect(summary.failed).toBe(0);
		expect(statSync(join(parent, "package.json")).nlink).toBeGreaterThan(1);
		expect(existsSync(bundledChild)).toBe(true);
		expect(statSync(bundledChild).nlink).toBeGreaterThan(1);
		expect(required("@aws-cdk/cloud-assembly-schema")).toBeDefined();
	});

	function openWorkspace(): Workspace {
		const root = mkdtempSync(join(tmpdir(), "znpm-convert-"));

		workspaces.push(root);

		return {
			root,
			store: join(root, "store"),
			cache: join(root, "npm-cache"),
			pnpmAppDirectory: join(root, "pnpm-app"),
		};
	}
});

function writeFixture(workspace: Workspace, name: string, dependencies: Record<string, string>): string {
	const fixture = join(workspace.root, name);

	mkdirSync(fixture, { recursive: true });
	writeNpmrc(fixture, workspace);
	writeFixtureManifest(fixture, dependencies);

	return fixture;
}

function writeNpmrc(fixture: string, workspace: Workspace): void {
	writeFileSync(join(fixture, ".npmrc"), `cache=${workspace.cache.replaceAll("\\", "/")}\n`, "utf8");
}

function writeFixtureManifest(fixture: string, dependencies: Record<string, string>): void {
	writeFileSync(
		join(fixture, "package.json"),
		`${JSON.stringify({ name: "znpm-fixture", private: true, dependencies }, undefined, "\t")}\n`,
		"utf8",
	);
}

async function convertProject(fixture: string, workspace: Workspace): Promise<ConvertSummary> {
	return convert(fixture, {
		storeDirectory: workspace.store,
		pnpmAppDirectory: workspace.pnpmAppDirectory,
		npmCacheDirectory: workspace.cache,
	});
}

function runNpm(
	cwd: string,
	npmArguments: Array<string>,
	workspace: Workspace,
): { stdout: string; stderr: string; status: number | null } {
	const npm = resolveNpm({ ...process.env, ZNPM_DISABLE: "1" }, appDirectoryOf(process.platform));
	const env: NodeJS.ProcessEnv = { ...process.env, ZNPM_DISABLE: "1" };

	for (const key of Object.keys(env)) {
		if (key.toLowerCase() === "npm_config_cache") {
			delete env[key];
		}
	}

	env.npm_config_cache = workspace.cache;
	env.npm_config_audit = "false";
	env.npm_config_fund = "false";
	env.npm_config_update_notifier = "false";
	env.GIT_CONFIG_COUNT = "1";
	env.GIT_CONFIG_KEY_0 = "protocol.file.allow";
	env.GIT_CONFIG_VALUE_0 = "always";

	const result = spawnSync(npm.command, [...npm.argsPrefix, ...npmArguments, "--cache", workspace.cache], {
		cwd,
		encoding: "utf8",
		env,
		timeout: 120_000,
	});

	if (result.error !== undefined) {
		throw result.error;
	}

	if (result.status !== 0) {
		throw new Error(
			`npm ${npmArguments.join(" ")} exited ${String(result.status)}\n${result.stdout}\n${result.stderr}`,
		);
	}

	return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

function runGit(cwd: string, gitArguments: Array<string>): { stdout: string } {
	const result = spawnSync("git", gitArguments, {
		cwd,
		encoding: "utf8",
		env: {
			...process.env,
			GIT_CONFIG_COUNT: "1",
			GIT_CONFIG_KEY_0: "protocol.file.allow",
			GIT_CONFIG_VALUE_0: "always",
		},
	});

	if (result.status !== 0) {
		throw new Error(`git ${gitArguments.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
	}

	return { stdout: result.stdout };
}

function inodeWalkOf(directory: string): Record<string, number> {
	const records: Record<string, number> = {};

	walkFiles(directory, (filePath) => {
		records[relative(directory, filePath).replaceAll("\\", "/")] = statSync(filePath).ino;
	});

	return records;
}

function treeBytesOf(directory: string): Record<string, string> {
	const records: Record<string, string> = {};

	walkFiles(directory, (filePath) => {
		records[relative(directory, filePath).replaceAll("\\", "/")] = readFileSync(filePath).toString("hex");
	});

	return records;
}

function fileCountOf(directory: string): number {
	let count = 0;

	if (!existsSync(directory)) {
		return 0;
	}

	walkFiles(directory, () => {
		count++;
	});

	return count;
}

function walkFiles(directory: string, visit: (filePath: string) => void): void {
	if (!existsSync(directory)) {
		return;
	}

	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const entryPath = join(directory, entry.name);

		if (entry.isDirectory()) {
			walkFiles(entryPath, visit);

			continue;
		}

		if (entry.isFile()) {
			visit(entryPath);
		}
	}
}

function tarballWantedPackageOf(fixture: string, name: string): { integrity: string; version: string | undefined } {
	const hiddenLockfile = readHiddenLockfile(fixture);
	const { wanted } = wantedPackagesOf(hiddenLockfile);
	const match = wanted.find((wantedPackage) => wantedPackage.name === name && "integrity" in wantedPackage.resolution);

	if (match === undefined || !("integrity" in match.resolution)) {
		throw new Error(`znpm test found no tarball entry for ${name}`);
	}

	return { integrity: match.resolution.integrity, version: match.version };
}
