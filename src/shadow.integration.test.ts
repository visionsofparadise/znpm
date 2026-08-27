import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const shadowScript = fileURLToPath(new URL("./shadow.ts", import.meta.url));
const sentinelSource = `"use strict";
const npmArguments = process.argv.slice(2);
process.stdout.write(JSON.stringify({ npmArguments, internal: process.env.ZNPM_INTERNAL ?? null }) + "\\n");
process.exit(npmArguments[0] === "fail" ? 7 : 0);
`;

describe("the shadow", () => {
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

		const result = spawnSync(process.execPath, ["--import", "tsx", shadowScript, ...options.npmArguments], {
			encoding: "utf8",
			env,
			timeout: 30_000,
		});

		return { status: result.status, stdout: result.stdout, stderr: result.stderr };
	}
});
