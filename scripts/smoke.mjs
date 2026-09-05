#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const platformNames = { win32: "windows", linux: "linux", darwin: "darwin" };
const platformName = platformNames[process.platform];

if (platformName === undefined) {
	console.error(`no npm wrapper binary is built for ${process.platform}`);
	process.exit(1);
}

const libcSuffix =
	process.platform === "linux" && process.report.getReport().header.glibcVersionRuntime === undefined ? "-musl" : "";

const npmWrapperBinary = join(
	repositoryRoot,
	"dist",
	`npm-wrapper-${platformName}-${process.arch}${libcSuffix}${process.platform === "win32" ? ".exe" : ""}`,
);

if (!existsSync(npmWrapperBinary)) {
	console.error(`missing compiled npm wrapper at ${npmWrapperBinary}`);
	process.exit(1);
}

const workspaceRoot = mkdtempSync(join(tmpdir(), "znpm-smoke-"));
const fixtureDirectory = join(workspaceRoot, "fixture");
const storeDirectory = join(workspaceRoot, "store");
const cacheDirectory = join(workspaceRoot, "npm-cache");
const appDirectory = join(workspaceRoot, "znpm");

mkdirSync(fixtureDirectory, { recursive: true });
mkdirSync(appDirectory, { recursive: true });
writeFileSync(
	join(appDirectory, "state.json"),
	`${JSON.stringify({ enabled: true, disabled: false, changes: [] })}\n`,
	"utf8",
);
writeFileSync(
	join(fixtureDirectory, "package.json"),
	`${JSON.stringify({ name: "znpm-smoke", private: true, dependencies: { ms: "2.1.3" } }, undefined, "\t")}\n`,
	"utf8",
);

const result = spawnSync(npmWrapperBinary, ["install"], {
	cwd: fixtureDirectory,
	env: childEnvironmentOf(workspaceRoot, storeDirectory, cacheDirectory, appDirectory),
	stdio: "inherit",
	timeout: 120_000,
});

const manifestPath = join(fixtureDirectory, "node_modules", "ms", "package.json");
const hardLinkCount = existsSync(manifestPath) ? statSync(manifestPath).nlink : 0;

try {
	rmSync(workspaceRoot, { recursive: true, force: true, maxRetries: 10 });
} catch {
	void 0;
}

if (result.error !== undefined) {
	console.error(result.error.message);
	process.exit(1);
}

if (result.status !== 0) {
	console.error(`compiled npm wrapper install exited ${String(result.status)}`);
	process.exit(result.status ?? 1);
}

if (hardLinkCount <= 1) {
	console.error(`expected store-linked tree (nlink > 1), got nlink ${String(hardLinkCount)}`);
	process.exit(1);
}

function childEnvironmentOf(isolatedRoot, storePath, cachePath, appPath) {
	const env = {};

	for (const [key, value] of Object.entries(process.env)) {
		if (key.toLowerCase() === "npm_config_cache" || key === "ZNPM_INTERNAL" || key === "ZNPM_DISABLE") {
			continue;
		}

		env[key] = value;
	}

	env.ZNPM_HOME = appPath;
	env.ZNPM_STORE_DIR = storePath;
	env.PNPM_HOME = join(isolatedRoot, "pnpm-home");
	env.LOCALAPPDATA = join(isolatedRoot, "Local");
	env.HOME = isolatedRoot;
	env.USERPROFILE = isolatedRoot;
	env.npm_config_cache = cachePath;
	env.npm_config_audit = "false";
	env.npm_config_fund = "false";
	env.npm_config_update_notifier = "false";

	return env;
}
