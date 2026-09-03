import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { version as znpmVersion } from "../package.json" with { type: "json" };
import { type ConvertSummary } from "./convert";
import { candidatePackagesOf, readHiddenLockfile } from "./hiddenLockfile";
import { cacacheTarballPathOf } from "./npmCache";

const npmWrapperScript = fileURLToPath(new URL("./npmWrapper.ts", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");
const sentinelSource = `"use strict";
const npmArguments = process.argv.slice(2);
process.stdout.write(JSON.stringify({ npmArguments, internal: process.env.ZNPM_INTERNAL ?? null }) + "\\n");
process.exit(npmArguments[0] === "fail" ? 7 : 0);
`;

describe("the npm wrapper", { timeout: 60_000 }, () => {
	let temporaryRoot: string;
	let localAppData: string;
	let fakeNpmDirectory: string;

	beforeEach(() => {
		temporaryRoot = mkdtempSync(join(tmpdir(), "znpm-npm-wrapper-"));
		localAppData = join(temporaryRoot, "Local");
		fakeNpmDirectory = join(temporaryRoot, "nodejs");

		mkdirSync(join(fakeNpmDirectory, "node_modules", "npm", "bin"), { recursive: true });
		writeFileSync(join(fakeNpmDirectory, "npm.cmd"), "", "utf8");
		writeFileSync(
			join(fakeNpmDirectory, "npm"),
			`#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' "$(dirname "$0")/node_modules/npm/bin/npm-cli.js" "$@"\n`,
			"utf8",
		);
		chmodSync(join(fakeNpmDirectory, "npm"), 0o755);
		writeFileSync(join(fakeNpmDirectory, "node_modules", "npm", "bin", "npm-cli.js"), sentinelSource, "utf8");
	});

	afterEach(() => {
		rmSync(temporaryRoot, { recursive: true, force: true });
	});

	it("execs real npm verbatim when ZNPM_INTERNAL is set", () => {
		const result = runShadow({
			npmArguments: ["install", "--znpm-disable", "left-pad"],
			env: { ZNPM_INTERNAL: "1" },
		});

		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({
			npmArguments: ["install", "--znpm-disable", "left-pad"],
			internal: "1",
		});
	});

	it("execs real npm verbatim when ZNPM_DISABLE is 1", () => {
		const result = runShadow({ npmArguments: ["install", "--znpm-disable"], env: { ZNPM_DISABLE: "1" } });

		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({
			npmArguments: ["install", "--znpm-disable"],
			internal: null,
		});
	});

	it("strips --znpm-disable and execs real npm", () => {
		const result = runShadow({ npmArguments: ["install", "--znpm-disable", "--json"] });

		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({
			npmArguments: ["install", "--json"],
			internal: null,
		});
	});

	it("passes ordinary commands through verbatim with ZNPM_INTERNAL set", () => {
		const result = runShadow({ npmArguments: ["install", "left-pad"] });
		const body = JSON.stringify({ npmArguments: ["install", "left-pad"], internal: "1" }) + "\n";

		expect(result.status).toBe(0);
		expect(result.stdout).toBe(body);
	});

	it("converts after install even when npm does not write a hidden lockfile", () => {
		writeFileSync(
			join(temporaryRoot, "package.json"),
			`${JSON.stringify({ name: "host", private: true })}\n`,
			"utf8",
		);

		const result = runShadow({
			npmArguments: ["install", "left-pad"],
			env: { npm_config_loglevel: "verbose" },
		});

		expect(result.status).toBe(0);
		expect(converterOutputLinesOf(result.stderr).some((line) => line.startsWith("znpm {"))).toBe(true);
	});

	it("does not convert after --version", () => {
		const result = runShadow({ npmArguments: ["--version"], env: { npm_config_loglevel: "verbose" } });

		expect(result.status).toBe(0);
		expect(converterSummariesOf(result.stderr)).toEqual([]);
		expect(result.stdout.endsWith(` (znpm ${znpmVersion})\n`)).toBe(true);
	});

	it("propagates a nonzero exit code", () => {
		const result = runShadow({ npmArguments: ["fail"] });

		expect(result.status).toBe(7);
	});

	it("appends (znpm <version>) to npm's version on stdout", () => {
		const result = runShadow({ npmArguments: ["--version"] });
		const body = JSON.stringify({ npmArguments: ["--version"], internal: "1" });

		expect(result.stdout).toBe(`${body} (znpm ${znpmVersion})\n`);
		expect(result.stderr.includes("znpm {")).toBe(false);
	});

	it("passes npm install -g through with no conversion attempt", () => {
		writeFileSync(
			join(temporaryRoot, "package.json"),
			`${JSON.stringify({ name: "host", private: true })}\n`,
			"utf8",
		);

		const result = runShadow({
			npmArguments: ["install", "-g", "cowsay"],
			env: { npm_config_loglevel: "verbose" },
		});

		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({
			npmArguments: ["install", "-g", "cowsay"],
			internal: "1",
		});
		expect(converterOutputLinesOf(result.stderr)).toEqual([]);
	});

	function runShadow(options: { npmArguments: Array<string>; env?: NodeJS.ProcessEnv }): {
		status: number | null;
		stdout: string;
		stderr: string;
	} {
		const env: NodeJS.ProcessEnv = {
			...process.env,
			...options.env,
			LOCALAPPDATA: localAppData,
			HOME: temporaryRoot,
			PATH: [fakeNpmDirectory, process.env.PATH ?? ""].join(delimiter),
		};

		deleteMatchingEnvKeys(env, ["npm_config_loglevel", "npm_config_json"]);

		if (options.env?.ZNPM_INTERNAL === undefined) {
			delete env.ZNPM_INTERNAL;
		}

		if (options.env?.ZNPM_DISABLE === undefined) {
			delete env.ZNPM_DISABLE;
		}

		if (options.env?.npm_config_loglevel !== undefined) {
			env.npm_config_loglevel = options.env.npm_config_loglevel;
		}

		if (options.env?.npm_config_json !== undefined) {
			env.npm_config_json = options.env.npm_config_json;
		}

		const result = spawnSync(process.execPath, ["--import", tsxLoader, npmWrapperScript, ...options.npmArguments], {
			cwd: temporaryRoot,
			encoding: "utf8",
			env,
			timeout: 30_000,
		});

		return { status: result.status, stdout: result.stdout, stderr: result.stderr };
	}
});

interface Workspace {
	root: string;
	store: string;
	cache: string;
	localAppData: string;
}

describe("the npm wrapper converting captured npm commands", { timeout: 180_000 }, () => {
	const workspaces: Array<string> = [];

	afterEach(() => {
		for (const root of workspaces.splice(0)) {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("store-links a captured npm install and exits 0", () => {
		const workspace = openWorkspace();
		const fixture = writeFixture(workspace, "fixture", { ms: "2.1.3" });
		const result = runCapturedShadow(fixture, ["install"], workspace, { npm_config_loglevel: "verbose" });
		const summaries = converterSummariesOf(result.stderr);

		expect(result.status).toBe(0);
		expect(statSync(join(fixture, "node_modules", "ms", "package.json")).nlink).toBeGreaterThan(1);
		expect(summaries.length).toBeGreaterThan(0);
		expect(summaries[0]?.imported).toBeGreaterThan(0);
		expect(summaries[0]?.failures).toEqual([]);
	});

	it("passes npm run and npm test through with zero converter output", () => {
		const workspace = openWorkspace();
		const fixture = writeFixture(
			workspace,
			"fixture",
			{ ms: "2.1.3" },
			{
				test: "node -e \"process.stdout.write('tested\\n')\"",
				hello: "node -e \"process.stdout.write('hello\\n')\"",
			},
		);

		expect(runCapturedShadow(fixture, ["install"], workspace).status).toBe(0);

		const run = runCapturedShadow(fixture, ["run", "hello"], workspace);
		const testResult = runCapturedShadow(fixture, ["test"], workspace);

		expect(run.status).toBe(0);
		expect(testResult.status).toBe(0);
		expect(run.stdout).toMatch(/hello/);
		expect(testResult.stdout).toMatch(/tested/);
		expect(converterOutputLinesOf(run.stderr)).toEqual([]);
		expect(converterOutputLinesOf(testResult.stderr)).toEqual([]);
	});

	it("reports up to date on a second npm install with links intact", () => {
		const workspace = openWorkspace();
		const fixture = writeFixture(workspace, "fixture", { ms: "2.1.3" });

		expect(runCapturedShadow(fixture, ["install"], workspace).status).toBe(0);

		const manifest = join(fixture, "node_modules", "ms", "package.json");
		const nlink = statSync(manifest).nlink;
		const second = runCapturedShadow(fixture, ["install"], workspace);

		expect(second.status).toBe(0);
		expect(`${second.stdout}\n${second.stderr}`).toMatch(/up to date/i);
		expect(statSync(manifest).nlink).toBe(nlink);
		expect(nlink).toBeGreaterThan(1);
	});

	it("preserves surviving links after npm uninstall and npm update", () => {
		const workspace = openWorkspace();
		const fixture = writeFixture(workspace, "fixture", { ms: "2.1.3", abbrev: "3.0.1" });

		expect(runCapturedShadow(fixture, ["install"], workspace).status).toBe(0);
		expect(statSync(join(fixture, "node_modules", "ms", "package.json")).nlink).toBeGreaterThan(1);
		expect(statSync(join(fixture, "node_modules", "abbrev", "package.json")).nlink).toBeGreaterThan(1);

		const uninstalled = runCapturedShadow(fixture, ["uninstall", "abbrev"], workspace);

		expect(uninstalled.status).toBe(0);
		expect(existsSync(join(fixture, "node_modules", "abbrev"))).toBe(false);
		expect(statSync(join(fixture, "node_modules", "ms", "package.json")).nlink).toBeGreaterThan(1);

		const updated = runCapturedShadow(fixture, ["update"], workspace);

		expect(updated.status).toBe(0);
		expect(statSync(join(fixture, "node_modules", "ms", "package.json")).nlink).toBeGreaterThan(1);
	});

	it("leaves every package directory untouched after npm install --package-lock-only", () => {
		const workspace = openWorkspace();
		const fixture = writeFixture(workspace, "fixture", { ms: "2.1.3" });
		const result = runCapturedShadow(fixture, ["install", "--package-lock-only"], workspace);

		expect(result.status).toBe(0);
		expect(existsSync(join(fixture, "node_modules", "ms"))).toBe(false);
	});

	it("warns on a conversion failure and still returns npm's exit code", () => {
		const workspace = openWorkspace();
		const fixture = writeFixture(workspace, "fixture", { ms: "2.1.3" });
		const blocker = join(workspace.root, "blocker");

		writeFileSync(blocker, "not a directory\n", "utf8");

		const result = runCapturedShadow(fixture, ["install"], workspace, {
			ZNPM_STORE_DIR: join(blocker, "store"),
		});

		expect(result.status).toBe(0);
		expect(result.stderr).toMatch(/znpm could not convert /);
		expect(result.stderr).toMatch(/node_modules is as npm left it/);
		expect(statSync(join(fixture, "node_modules", "ms", "package.json")).nlink).toBe(1);
	});

	it("keeps stdout as npm's alone on a --json install", () => {
		const workspace = openWorkspace();
		const fixture = writeFixture(workspace, "fixture", { ms: "2.1.3" });
		const result = runCapturedShadow(fixture, ["install", "--json"], workspace);

		expect(result.status).toBe(0);
		expect(() => JSON.parse(result.stdout) as unknown).not.toThrow();
		expect(statSync(join(fixture, "node_modules", "ms", "package.json")).nlink).toBeGreaterThan(1);
		expect(result.stdout.split(/\r?\n/).filter((line) => line.startsWith("znpm"))).toEqual([]);
		expect(converterOutputLinesOf(result.stderr)).toEqual([]);
	});

	it("prints one stdout line when packages stay unlinked", () => {
		const workspace = openWorkspace();
		const fixture = writeFixture(workspace, "fixture", { ms: "2.1.3", abbrev: "3.0.1" });

		expect(runCapturedShadow(fixture, ["install"], workspace, { ZNPM_DISABLE: "1" }).status).toBe(0);

		const victim = tarballCandidatePackageOf(fixture, "abbrev");
		const cacachePath = cacacheTarballPathOf(workspace.cache, victim.integrity);

		expect(cacachePath).toBeDefined();

		if (cacachePath !== undefined) {
			const original = readFileSync(cacachePath);
			const corrupted = Buffer.from(original);

			corrupted.writeUInt8(corrupted.readUInt8(20) ^ 0xff, 20);
			writeFileSync(cacachePath, corrupted);
		}

		const result = runCapturedShadow(fixture, ["install"], workspace);
		const msManifest = join(fixture, "node_modules", "ms", "package.json");
		const abbrevManifest = join(fixture, "node_modules", "abbrev", "package.json");

		expect(result.status).toBe(0);
		expect(result.stdout).toContain("znpm: 1 package not linked to the store; node_modules is unaffected");
		expect(result.stderr.split(/\r?\n/).filter((line) => line.startsWith("znpm "))).toEqual([]);
		expect(statSync(msManifest).nlink).toBeGreaterThan(1);
		expect(statSync(abbrevManifest).nlink).toBe(1);
		expect(JSON.parse(readFileSync(abbrevManifest, "utf8")).version).toBe(victim.version);
	});

	it("prints nothing when every package links", () => {
		const workspace = openWorkspace();
		const fixture = writeFixture(workspace, "fixture", { ms: "2.1.3" });
		const result = runCapturedShadow(fixture, ["install"], workspace);

		expect(result.status).toBe(0);
		expect(result.stdout.split(/\r?\n/).filter((line) => line.startsWith("znpm"))).toEqual([]);
		expect(result.stderr.split(/\r?\n/).filter((line) => line.startsWith("znpm"))).toEqual([]);
	});

	function openWorkspace(): Workspace {
		const root = mkdtempSync(join(tmpdir(), "znpm-npm-wrapper-convert-"));

		workspaces.push(root);

		return {
			root,
			store: join(root, "store"),
			cache: join(root, "npm-cache"),
			localAppData: join(root, "Local"),
		};
	}
});

function writeFixture(
	workspace: Workspace,
	name: string,
	dependencies: Record<string, string>,
	scripts?: Record<string, string>,
): string {
	const fixture = join(workspace.root, name);

	mkdirSync(fixture, { recursive: true });
	writeFileSync(join(fixture, ".npmrc"), `cache=${workspace.cache.replaceAll("\\", "/")}\n`, "utf8");
	writeFileSync(
		join(fixture, "package.json"),
		`${JSON.stringify({ name: "znpm-fixture", private: true, dependencies, ...(scripts === undefined ? {} : { scripts }) }, undefined, "\t")}\n`,
		"utf8",
	);

	return fixture;
}

function runCapturedShadow(
	cwd: string,
	npmArguments: Array<string>,
	workspace: Workspace,
	envOverrides: NodeJS.ProcessEnv = {},
): { status: number | null; stdout: string; stderr: string } {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		...envOverrides,
		LOCALAPPDATA: workspace.localAppData,
		HOME: workspace.root,
		ZNPM_STORE_DIR: envOverrides.ZNPM_STORE_DIR ?? workspace.store,
		npm_config_cache: workspace.cache,
		npm_config_audit: "false",
		npm_config_fund: "false",
		npm_config_update_notifier: "false",
	};

	for (const key of Object.keys(env)) {
		if (key.toLowerCase() === "npm_config_cache" && key !== "npm_config_cache") {
			delete env[key];
		}
	}

	deleteMatchingEnvKeys(env, ["npm_config_loglevel", "npm_config_json"]);

	env.npm_config_cache = workspace.cache;
	delete env.ZNPM_INTERNAL;
	delete env.ZNPM_DISABLE;

	if (envOverrides.ZNPM_DISABLE !== undefined) {
		env.ZNPM_DISABLE = envOverrides.ZNPM_DISABLE;
	}

	if (envOverrides.npm_config_loglevel !== undefined) {
		env.npm_config_loglevel = envOverrides.npm_config_loglevel;
	}

	if (envOverrides.npm_config_json !== undefined) {
		env.npm_config_json = envOverrides.npm_config_json;
	}

	if (envOverrides.ZNPM_STORE_DIR !== undefined) {
		env.ZNPM_STORE_DIR = envOverrides.ZNPM_STORE_DIR;
	}

	const result = spawnSync(process.execPath, ["--import", tsxLoader, npmWrapperScript, ...npmArguments], {
		cwd,
		encoding: "utf8",
		env,
		timeout: 120_000,
	});

	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function deleteMatchingEnvKeys(env: NodeJS.ProcessEnv, names: Array<string>): void {
	const namesToDelete = new Set(names.map((name) => name.toLowerCase()));

	for (const key of Object.keys(env)) {
		if (namesToDelete.has(key.toLowerCase())) {
			delete env[key];
		}
	}
}

function converterOutputLinesOf(stderr: string): Array<string> {
	return stderr.split(/\r?\n/).filter((line) => line.startsWith("znpm "));
}

function converterSummariesOf(stderr: string): Array<ConvertSummary> {
	return converterOutputLinesOf(stderr)
		.filter((line) => line.startsWith("znpm {"))
		.map((line) => JSON.parse(line.slice("znpm ".length)) as ConvertSummary);
}

function tarballCandidatePackageOf(fixture: string, name: string): { integrity: string; version: string | undefined } {
	const hiddenLockfile = readHiddenLockfile(fixture);
	const { candidatePackages } = candidatePackagesOf(hiddenLockfile);
	const match = candidatePackages.find(
		(candidatePackage) => candidatePackage.name === name && "integrity" in candidatePackage.resolution,
	);

	if (match === undefined || !("integrity" in match.resolution)) {
		throw new Error(`znpm test found no tarball entry for ${name}`);
	}

	return { integrity: match.resolution.integrity, version: match.version };
}
