import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ConvertSummary } from "./convert";

const shadowScript = fileURLToPath(new URL("./shadow.ts", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");
const sentinelSource = `"use strict";
const npmArguments = process.argv.slice(2);
process.stdout.write(JSON.stringify({ npmArguments, internal: process.env.ZNPM_INTERNAL ?? null }) + "\\n");
process.exit(npmArguments[0] === "fail" ? 7 : 0);
`;

describe("the shadow", { timeout: 60_000 }, () => {
	let temporaryRoot: string;
	let localAppData: string;
	let fakeNpmDirectory: string;

	beforeEach(() => {
		temporaryRoot = mkdtempSync(join(tmpdir(), "znpm-shadow-"));
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

	it("propagates a nonzero exit code", () => {
		const result = runShadow({ npmArguments: ["fail"] });

		expect(result.status).toBe(7);
	});

	it("writes only npm's output to stdout", () => {
		const result = runShadow({ npmArguments: ["--version"] });

		expect(result.stdout.endsWith("\n")).toBe(true);
		expect(result.stdout.slice(0, -1).includes("\n")).toBe(false);
		expect(JSON.parse(result.stdout)).toEqual({
			npmArguments: ["--version"],
			internal: "1",
		});
	});

	it("passes npm install -g through with no conversion attempt", () => {
		writeFileSync(
			join(temporaryRoot, "package.json"),
			`${JSON.stringify({ name: "host", private: true })}\n`,
			"utf8",
		);

		const result = runShadow({ npmArguments: ["install", "-g", "cowsay"] });

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

		if (options.env?.ZNPM_INTERNAL === undefined) {
			delete env.ZNPM_INTERNAL;
		}

		if (options.env?.ZNPM_DISABLE === undefined) {
			delete env.ZNPM_DISABLE;
		}

		const result = spawnSync(process.execPath, ["--import", tsxLoader, shadowScript, ...options.npmArguments], {
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

describe("the shadow converting captured npm commands", { timeout: 180_000 }, () => {
	const workspaces: Array<string> = [];

	afterEach(() => {
		for (const root of workspaces.splice(0)) {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("store-links a captured npm install and exits 0", () => {
		const workspace = openWorkspace();
		const fixture = writeFixture(workspace, "fixture", { ms: "2.1.3" });
		const result = runCapturedShadow(fixture, ["install"], workspace);
		const summaries = converterSummariesOf(result.stderr);

		expect(result.status).toBe(0);
		expect(statSync(join(fixture, "node_modules", "ms", "package.json")).nlink).toBeGreaterThan(1);
		expect(summaries.length).toBeGreaterThan(0);
		expect(summaries[0]?.imported).toBeGreaterThan(0);
		expect(summaries[0]?.failed).toBe(0);
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
		expect(statSync(join(fixture, "node_modules", "ms", "package.json")).nlink).toBe(1);
	});

	it("keeps stdout as npm's alone on a --json install", () => {
		const workspace = openWorkspace();
		const fixture = writeFixture(workspace, "fixture", { ms: "2.1.3" });
		const result = runCapturedShadow(fixture, ["install", "--json"], workspace);

		expect(result.status).toBe(0);
		expect(() => JSON.parse(result.stdout) as unknown).not.toThrow();
		expect(statSync(join(fixture, "node_modules", "ms", "package.json")).nlink).toBeGreaterThan(1);
		expect(converterOutputLinesOf(result.stderr).length).toBeGreaterThan(0);
	});

	function openWorkspace(): Workspace {
		const root = mkdtempSync(join(tmpdir(), "znpm-shadow-convert-"));

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

	env.npm_config_cache = workspace.cache;
	delete env.ZNPM_INTERNAL;
	delete env.ZNPM_DISABLE;

	if (envOverrides.ZNPM_STORE_DIR !== undefined) {
		env.ZNPM_STORE_DIR = envOverrides.ZNPM_STORE_DIR;
	}

	const result = spawnSync(process.execPath, ["--import", tsxLoader, shadowScript, ...npmArguments], {
		cwd,
		encoding: "utf8",
		env,
		timeout: 120_000,
	});

	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function converterOutputLinesOf(stderr: string): Array<string> {
	return stderr.split(/\r?\n/).filter((line) => line.startsWith("znpm "));
}

function converterSummariesOf(stderr: string): Array<ConvertSummary> {
	return converterOutputLinesOf(stderr)
		.filter((line) => line.startsWith("znpm {"))
		.map((line) => JSON.parse(line.slice("znpm ".length)) as ConvertSummary);
}
