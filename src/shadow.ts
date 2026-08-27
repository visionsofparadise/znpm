import { spawnSync } from "node:child_process";
import { convert } from "./convert";
import { homeDirectoryOf } from "./home";
import { npmCacheDirectoryOf } from "./npmCache";
import { pnpmHomeDirectoryOf } from "./pnpmHome";
import { resolveRealNpm, type RealNpm } from "./realNpm";
import { candidateTreeDirectoriesOf, hiddenLockfileStatOf, type HiddenLockfileStat } from "./targetTrees";
import { runCli } from "./utils/runCli";
import { setPnpmWorkerScriptPath } from "./utils/setPnpmWorkerScriptPath";
import { userArgumentsOf } from "./utils/userArgumentsOf";

setPnpmWorkerScriptPath();
await runCli(main);

async function main(): Promise<void> {
	const npmArguments = userArgumentsOf(process.argv, import.meta.url);
	const realNpm = resolveRealNpm(process.env, homeDirectoryOf(process.platform));

	if (process.env.ZNPM_INTERNAL !== undefined) {
		exitWithRealNpm(realNpm, npmArguments, process.env);
	}

	if (process.env.ZNPM_DISABLE === "1") {
		exitWithRealNpm(realNpm, npmArguments, process.env);
	}

	if (npmArguments.includes("--znpm-disable")) {
		exitWithRealNpm(
			realNpm,
			npmArguments.filter((argument) => argument !== "--znpm-disable"),
			process.env,
		);
	}

	await convertChangedTrees(realNpm, npmArguments);
}

async function convertChangedTrees(realNpm: RealNpm, npmArguments: Array<string>): Promise<void> {
	const candidates = candidateTreeDirectoriesOf(process.cwd(), npmArguments);
	const before = candidates.map((directory) => hiddenLockfileStatOf(directory));
	const status = spawnRealNpm(realNpm, npmArguments, { ...process.env, ZNPM_INTERNAL: "1" });

	const after = candidates.map((directory) => hiddenLockfileStatOf(directory));

	for (const [index, candidate] of candidates.entries()) {
		if (hiddenLockfileStatsEqual(before[index], after[index])) {
			continue;
		}

		await convertCandidate(candidate);
	}

	process.exit(status);
}

async function convertCandidate(projectDirectory: string): Promise<void> {
	const storeDirectory = process.env.ZNPM_STORE_DIR;

	try {
		const summary = await convert(projectDirectory, {
			...(storeDirectory !== undefined && storeDirectory !== "" ? { storeDirectory } : {}),
			pnpmHomeDirectory: pnpmHomeDirectoryOf(process.env, process.platform),
			npmCacheDirectory: npmCacheDirectoryOf(process.env, process.platform),
		});

		console.error(`znpm ${JSON.stringify(summary)}`);
	} catch (error: unknown) {
		console.error(
			`znpm could not convert ${projectDirectory}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function hiddenLockfileStatsEqual(
	left: HiddenLockfileStat | undefined,
	right: HiddenLockfileStat | undefined,
): boolean {
	if (left === undefined || right === undefined) {
		return left === right;
	}

	return left.mtimeMs === right.mtimeMs && left.size === right.size;
}

function exitWithRealNpm(realNpm: RealNpm, npmArguments: Array<string>, env: NodeJS.ProcessEnv): never {
	process.exit(spawnRealNpm(realNpm, npmArguments, env));
}

function spawnRealNpm(realNpm: RealNpm, npmArguments: Array<string>, env: NodeJS.ProcessEnv): number {
	const result = spawnSync(realNpm.command, [...realNpm.argsPrefix, ...npmArguments], {
		stdio: "inherit",
		env,
	});

	if (result.error !== undefined) {
		console.error(result.error.message);
		process.exit(1);
	}

	return result.status ?? 1;
}
