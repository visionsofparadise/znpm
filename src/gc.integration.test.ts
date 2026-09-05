import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { restartWorkerPool } from "@pnpm/worker";
import { afterEach, describe, expect, it } from "vitest";
import { appDirectoryOf } from "./appData";
import { convert } from "./convert";
import { resolveNpm } from "./npm";

const znpmScript = fileURLToPath(new URL("./znpm.ts", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");

interface Workspace {
	root: string;
	cache: string;
	pnpmAppDirectory: string;
	localAppData: string;
}

describe("znpm gc", { timeout: 180_000 }, () => {
	const workspaces: Array<string> = [];

	afterEach(async () => {
		await restartWorkerPool();

		for (const root of workspaces.splice(0)) {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("prunes orphaned files from a deleted project's store and exits 0", async () => {
		const workspace = openWorkspace();
		const fixture = writeFixture(workspace, "fixture", { ms: "2.1.3" });

		runNpm(fixture, ["install"], workspace);

		const summary = await convert(fixture, {
			pnpmAppDirectory: workspace.pnpmAppDirectory,
			npmCacheDirectory: workspace.cache,
		});
		const storeFileCountBefore = fileCountOf(summary.storeDirectory);

		expect(storeFileCountBefore).toBeGreaterThan(0);

		rmSync(fixture, { recursive: true, force: true });

		const result = spawnSync(process.execPath, ["--import", tsxLoader, znpmScript, "gc"], {
			cwd: workspace.root,
			encoding: "utf8",
			env: {
				...process.env,
				LOCALAPPDATA: workspace.localAppData,
				HOME: workspace.root,
				PNPM_HOME: workspace.pnpmAppDirectory,
			},
			timeout: 60_000,
		});

		expect(result.status).toBe(0);
		expect(fileCountOf(summary.storeDirectory)).toBeLessThan(storeFileCountBefore);
	});

	function openWorkspace(): Workspace {
		const root = mkdtempSync(join(tmpdir(), "znpm-gc-"));

		workspaces.push(root);

		return {
			root,
			cache: join(root, "npm-cache"),
			pnpmAppDirectory: join(root, "pnpm-app"),
			localAppData: join(root, "Local"),
		};
	}
});

function writeFixture(workspace: Workspace, name: string, dependencies: Record<string, string>): string {
	const fixture = join(workspace.root, name);

	mkdirSync(fixture, { recursive: true });
	writeFileSync(join(fixture, ".npmrc"), `cache=${workspace.cache.replaceAll("\\", "/")}\n`, "utf8");
	writeFileSync(
		join(fixture, "package.json"),
		`${JSON.stringify({ name: "znpm-fixture", private: true, dependencies }, undefined, "\t")}\n`,
		"utf8",
	);

	return fixture;
}

function runNpm(cwd: string, npmArguments: Array<string>, workspace: Workspace): void {
	const npm = resolveNpm({ ...process.env, ZNPM_DISABLE: "1" }, appDirectoryOf(process.env, process.platform));
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
}

function fileCountOf(directory: string): number {
	let count = 0;

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
