export type NpmReportLevel = "silent" | "line" | "verbose";

export function npmReportLevelOf(argv: Array<string>, env: NodeJS.ProcessEnv): NpmReportLevel {
	let sawSilentFlag = false;
	let sawVerboseFlag = false;

	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];

		if (argument === undefined) {
			continue;
		}

		if (argument === "--") {
			break;
		}

		if (
			argument === "--json" ||
			argument === "--json=true" ||
			argument === "--silent" ||
			argument === "-s" ||
			argument === "--loglevel=silent" ||
			argument === "--loglevel=error"
		) {
			sawSilentFlag = true;

			continue;
		}

		if (
			argument === "--verbose" ||
			argument === "-dd" ||
			argument === "-ddd" ||
			argument === "--loglevel=verbose" ||
			argument === "--loglevel=silly"
		) {
			sawVerboseFlag = true;

			continue;
		}

		if (argument.startsWith("--") && argument.includes("=")) {
			continue;
		}

		if (!argument.startsWith("-")) {
			continue;
		}

		const flagName = argument.startsWith("--") ? argument.slice(2) : argument.slice(1);

		if (flagName === "loglevel") {
			const value = argv[index + 1];

			index++;

			if (value === "silent" || value === "error") {
				sawSilentFlag = true;
			} else if (value === "verbose" || value === "silly") {
				sawVerboseFlag = true;
			}
		}
	}

	if (sawSilentFlag) {
		return "silent";
	}

	if (sawVerboseFlag) {
		return "verbose";
	}

	if (env.npm_config_json === "true" || env.npm_config_json === "1") {
		return "silent";
	}

	if (env.npm_config_loglevel === "silent" || env.npm_config_loglevel === "error") {
		return "silent";
	}

	if (env.npm_config_loglevel === "verbose" || env.npm_config_loglevel === "silly") {
		return "verbose";
	}

	return "line";
}
