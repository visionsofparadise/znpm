import { spawnSync } from "node:child_process";
import { finishWorkers } from "@pnpm/worker";
import { appDirectoryOf } from "./appData";
import { convert } from "./convert";
import { isTreeMutatingNpmCommand } from "./isTreeMutatingNpmCommand";
import { resolveNpm, type Npm } from "./npm";
import { npmCacheDirectoryOf } from "./npmCache";
import { pnpmAppDirectoryOf } from "./pnpmAppData";
import { storeDirectoryOverrideOf } from "./storeDirectoryOverrideOf";
import { candidateTreeDirectoriesOf } from "./targetTrees";
import { runCli } from "./utils/runCli";
import { setPnpmWorkerScriptPath } from "./utils/setPnpmWorkerScriptPath";
import { userArgumentsOf } from "./utils/userArgumentsOf";

setPnpmWorkerScriptPath();
await runCli(main);

async function main(): Promise<void> {
	const npmArguments = userArgumentsOf(process.argv, import.meta.url);
	const npm = resolveNpm(process.env, appDirectoryOf(process.platform));

	if (process.env.ZNPM_INTERNAL !== undefined) {
		exitWithNpm(npm, npmArguments, process.env);
	}

	if (process.env.ZNPM_DISABLE === "1") {
		exitWithNpm(npm, npmArguments, process.env);
	}

	if (npmArguments.includes("--znpm-disable")) {
		exitWithNpm(
			npm,
			npmArguments.filter((argument) => argument !== "--znpm-disable"),
			process.env,
		);
	}

	if (!isTreeMutatingNpmCommand(npmArguments)) {
		exitWithNpm(npm, npmArguments, { ...process.env, ZNPM_INTERNAL: "1" });
	}

	await convertAfterNpm(npm, npmArguments);
}

async function convertAfterNpm(npm: Npm, npmArguments: Array<string>): Promise<void> {
	const candidates = candidateTreeDirectoriesOf(process.cwd(), npmArguments);
	const status = spawnNpm(npm, npmArguments, { ...process.env, ZNPM_INTERNAL: "1" });

	try {
		for (const candidate of candidates) {
			await convertCandidate(candidate);
		}
	} finally {
		await finishWorkers();
	}

	process.exit(status);
}

async function convertCandidate(projectDirectory: string): Promise<void> {
	const storeDirectory = storeDirectoryOverrideOf(process.env);

	try {
		const summary = await convert(projectDirectory, {
			...(storeDirectory === undefined ? {} : { storeDirectory }),
			pnpmAppDirectory: pnpmAppDirectoryOf(process.env, process.platform),
			npmCacheDirectory: npmCacheDirectoryOf(process.env, process.platform),
		});

		console.error(`znpm ${JSON.stringify(summary)}`);
	} catch (error: unknown) {
		console.error(
			`znpm could not convert ${projectDirectory}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function exitWithNpm(npm: Npm, npmArguments: Array<string>, env: NodeJS.ProcessEnv): never {
	process.exit(spawnNpm(npm, npmArguments, env));
}

function spawnNpm(npm: Npm, npmArguments: Array<string>, env: NodeJS.ProcessEnv): number {
	const result = spawnSync(npm.command, [...npm.argsPrefix, ...npmArguments], {
		stdio: "inherit",
		env,
	});

	if (result.error !== undefined) {
		console.error(result.error.message);
		process.exit(1);
	}

	return result.status ?? 1;
}
