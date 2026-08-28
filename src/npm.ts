import { existsSync, realpathSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { npmWrapperPathOf, readState, shimDirectoryOf } from "./appData";

export interface Npm {
	command: string;
	argsPrefix: Array<string>;
}

export function npmPathOf(env: NodeJS.ProcessEnv, appDirectory: string): string {
	const npmPath = pathEntryNpmOf(env, appDirectory) ?? readState(appDirectory).npmPath;

	if (npmPath === undefined) {
		throw new Error("znpm found no real npm on PATH and none recorded in its state");
	}

	return npmPath;
}

export function resolveNpm(env: NodeJS.ProcessEnv, appDirectory: string): Npm {
	return npmOf(npmPathOf(env, appDirectory));
}

function pathEntryNpmOf(env: NodeJS.ProcessEnv, appDirectory: string): string | undefined {
	const shimDirectory = canonicalPathOf(shimDirectoryOf(appDirectory));
	const npmWrapperPath = canonicalPathOf(npmWrapperPathOf(appDirectory));
	const npmName = process.platform === "win32" ? "npm.cmd" : "npm";

	for (const entry of (env.PATH ?? "").split(delimiter)) {
		if (entry === "") {
			continue;
		}

		const candidate = join(entry, npmName);

		if (!existsSync(candidate)) {
			continue;
		}

		if (canonicalPathOf(dirname(candidate)) === shimDirectory) {
			continue;
		}

		if (canonicalPathOf(candidate) === npmWrapperPath) {
			continue;
		}

		return candidate;
	}

	return undefined;
}

function npmOf(npmPath: string): Npm {
	if (process.platform !== "win32") {
		return { command: npmPath, argsPrefix: [] };
	}

	const installationDirectory = dirname(npmPath);
	const nodePath = join(installationDirectory, "node.exe");

	return {
		command: existsSync(nodePath) ? nodePath : "node",
		argsPrefix: [join(installationDirectory, "node_modules", "npm", "bin", "npm-cli.js")],
	};
}

function canonicalPathOf(path: string): string {
	try {
		return realpathSync.native(path);
	} catch {
		return resolve(path);
	}
}
