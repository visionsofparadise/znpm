export function isNpmVersionQuery(argv: Array<string>): boolean {
	let sawVersionFlag = false;

	for (const argument of argv) {
		if (argument === "--") {
			break;
		}

		if (argument === "-v" || argument === "--version") {
			sawVersionFlag = true;

			continue;
		}

		if (!argument.startsWith("-")) {
			return false;
		}
	}

	return sawVersionFlag;
}
