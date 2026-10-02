import { existsSync, realpathSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { readState } from "./appData";

export interface Npm {
	command: string;
	argsPrefix: Array<string>;
}

export function npmPathOf(env: NodeJS.ProcessEnv, appDirectory: string): string {
	const recordedNpmPath = readState(appDirectory).npmPath;
	const npmPath =
		pathEntryNpmOf(env, appDirectory) ??
		(recordedNpmPath !== undefined && !isInsideAppDirectory(recordedNpmPath, appDirectory)
			? recordedNpmPath
			: undefined);

	if (npmPath === undefined) {
		throw new Error(
			"znpm wraps npm and depends on it: no npm was found on PATH, and none is recorded in znpm's state. Install Node.js and npm, then run znpm enable.",
		);
	}

	return npmPath;
}

export function resolveNpm(env: NodeJS.ProcessEnv, appDirectory: string): Npm {
	return npmOf(npmPathOf(env, appDirectory));
}

function pathEntryNpmOf(env: NodeJS.ProcessEnv, appDirectory: string): string | undefined {
	const executablePath = canonicalPathOf(process.execPath);
	const npmName = process.platform === "win32" ? "npm.cmd" : "npm";

	for (const entry of (env.PATH ?? "").split(delimiter)) {
		if (entry === "") {
			continue;
		}

		const candidateNpmPath = join(entry, npmName);

		if (!existsSync(candidateNpmPath)) {
			continue;
		}

		if (isRunningExecutableNpm(candidateNpmPath, executablePath)) {
			continue;
		}

		if (isInsideAppDirectory(candidateNpmPath, appDirectory)) {
			continue;
		}

		return candidateNpmPath;
	}

	return undefined;
}

export function isInsideAppDirectory(path: string, appDirectory: string): boolean {
	const relativePath = relative(canonicalPathOf(appDirectory), canonicalPathOf(path));

	return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

function isRunningExecutableNpm(candidateNpmPath: string, executablePath: string): boolean {
	if (canonicalPathOf(candidateNpmPath) === executablePath) {
		return true;
	}

	if (process.platform !== "win32") {
		return false;
	}

	return canonicalPathOf(join(dirname(candidateNpmPath), "npm.exe")) === executablePath;
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
