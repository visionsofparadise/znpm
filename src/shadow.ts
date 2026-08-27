import { spawnSync } from "node:child_process";
import { homeDirectoryOf } from "./home";
import { resolveRealNpm, type RealNpm } from "./realNpm";
import { runCli } from "./utils/runCli";
import { userArgumentsOf } from "./utils/userArgumentsOf";

runCli(main);

function main(): void {
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

	exitWithRealNpm(realNpm, npmArguments, { ...process.env, ZNPM_INTERNAL: "1" });
}

function exitWithRealNpm(realNpm: RealNpm, npmArguments: Array<string>, env: NodeJS.ProcessEnv): never {
	const result = spawnSync(realNpm.command, [...realNpm.argsPrefix, ...npmArguments], {
		stdio: "inherit",
		env,
	});

	if (result.error !== undefined) {
		console.error(result.error.message);
		process.exit(1);
	}

	process.exit(result.status ?? 1);
}
