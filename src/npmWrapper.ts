import { spawnSync } from "node:child_process";
import { finishWorkers } from "@pnpm/worker";
import { version as znpmVersion } from "../package.json" with { type: "json" };
import { appDirectoryOf, readState } from "./appData";
import { convert } from "./convert";
import { isNpmVersionQuery } from "./isNpmVersionQuery";
import { isTreeMutatingNpmCommand } from "./isTreeMutatingNpmCommand";
import { resolveNpm, type Npm } from "./npm";
import { npmCacheDirectoryOf } from "./npmCache";
import { npmReportLevelOf, type NpmReportLevel } from "./npmReportLevelOf";
import { npmVersionLineOf } from "./npmVersionLineOf";
import { pnpmAppDirectoryOf } from "./pnpmAppData";
import { storeDirectoryOverrideOf } from "./storeDirectoryOverrideOf";
import { candidateTreeDirectoriesOf } from "./targetTrees";
import { unlinkedLineOf } from "./unlinkedLineOf";
import { runCli } from "./utils/runCli";
import { setPnpmWorkerScriptPath } from "./utils/setPnpmWorkerScriptPath";
import { userArgumentsOf } from "./utils/userArgumentsOf";

setPnpmWorkerScriptPath();
await runCli(main);

async function main(): Promise<void> {
	const npmArguments = userArgumentsOf(process.argv, import.meta.url);
	const appDirectory = appDirectoryOf(process.platform);
	const npm = resolveNpm(process.env, appDirectory);

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

	if (readState(appDirectory).disabled) {
		exitWithNpm(npm, npmArguments, process.env);
	}

	if (!isTreeMutatingNpmCommand(npmArguments)) {
		const env = { ...process.env, ZNPM_INTERNAL: "1" };

		if (isNpmVersionQuery(npmArguments)) {
			process.exit(spawnNpmVersion(npm, npmArguments, env));
		}

		process.exit(spawnNpm(npm, npmArguments, env));
	}

	await convertAfterNpm(npm, npmArguments);
}

async function convertAfterNpm(npm: Npm, npmArguments: Array<string>): Promise<void> {
	const candidateTreeDirectories = candidateTreeDirectoriesOf(process.cwd(), npmArguments);
	const status = spawnNpm(npm, npmArguments, { ...process.env, ZNPM_INTERNAL: "1" });
	const reportLevel = npmReportLevelOf(npmArguments, process.env);

	try {
		for (const candidateTreeDirectory of candidateTreeDirectories) {
			await convertCandidateTreeDirectory(candidateTreeDirectory, reportLevel);
		}
	} finally {
		await finishWorkers();
	}

	process.exit(status);
}

async function convertCandidateTreeDirectory(projectDirectory: string, reportLevel: NpmReportLevel): Promise<void> {
	const storeDirectory = storeDirectoryOverrideOf(process.env);

	try {
		const summary = await convert(projectDirectory, {
			...(storeDirectory === undefined ? {} : { storeDirectory }),
			pnpmAppDirectory: pnpmAppDirectoryOf(process.env, process.platform),
			npmCacheDirectory: npmCacheDirectoryOf(process.env, process.platform),
		});
		const unlinked = summary.failures.length + summary.locked;

		if (reportLevel === "verbose") {
			console.error(`znpm ${JSON.stringify(summary)}`);
		}

		if ((reportLevel === "line" || reportLevel === "verbose") && unlinked > 0) {
			process.stdout.write(`${unlinkedLineOf(unlinked)}\n`);
		}
	} catch (error: unknown) {
		console.error(
			`znpm could not convert ${projectDirectory}: ${error instanceof Error ? error.message : String(error)}; node_modules is as npm left it`,
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

function spawnNpmVersion(npm: Npm, npmArguments: Array<string>, env: NodeJS.ProcessEnv): number {
	const result = spawnSync(npm.command, [...npm.argsPrefix, ...npmArguments], {
		encoding: "utf8",
		stdio: ["inherit", "pipe", "inherit"],
		env,
	});

	if (result.error !== undefined) {
		console.error(result.error.message);
		process.exit(1);
	}

	const status = result.status ?? 1;

	process.stdout.write(status === 0 ? npmVersionLineOf(result.stdout, znpmVersion) : result.stdout);

	return status;
}
