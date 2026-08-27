import { existsSync, realpathSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { readState, shadowPathOf, shimDirectoryOf } from "./home";

export interface RealNpm {
	command: string;
	argsPrefix: Array<string>;
}

export function realNpmPathOf(env: NodeJS.ProcessEnv, homeDirectory: string): string {
	const npmPath = pathEntryNpmOf(env, homeDirectory) ?? readState(homeDirectory).realNpmPath;

	if (npmPath === undefined) {
		throw new Error("znpm found no real npm on PATH and none recorded in its state");
	}

	return npmPath;
}

export function resolveRealNpm(env: NodeJS.ProcessEnv, homeDirectory: string): RealNpm {
	return realNpmOf(realNpmPathOf(env, homeDirectory));
}

function pathEntryNpmOf(env: NodeJS.ProcessEnv, homeDirectory: string): string | undefined {
	const shimDirectory = canonicalPathOf(shimDirectoryOf(homeDirectory));
	const shadowPath = canonicalPathOf(shadowPathOf(homeDirectory));
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

		if (canonicalPathOf(candidate) === shadowPath) {
			continue;
		}

		return candidate;
	}

	return undefined;
}

function realNpmOf(npmPath: string): RealNpm {
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
