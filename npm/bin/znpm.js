#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { platformPackageOf } from "../lib/platformPackageOf.js";

const musl = process.platform === "linux" && process.report.getReport().header.glibcVersionRuntime === undefined;
const { name, binary } = platformPackageOf(process.platform, process.arch, musl);

let packageDirectory;

try {
	packageDirectory = dirname(createRequire(import.meta.url).resolve(`${name}/package.json`));
} catch {
	console.error(`znpm has no binary for this platform: install ${name}`);
	process.exit(1);
}

const result = spawnSync(join(packageDirectory, binary), process.argv.slice(2), { stdio: "inherit" });

if (result.error !== undefined) {
	console.error(result.error.message);
	process.exit(1);
}

process.exit(result.status ?? 1);
