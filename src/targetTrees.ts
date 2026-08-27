import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface HiddenLockfileStat {
	mtimeMs: number;
	size: number;
}

export function candidateTreeDirectoriesOf(cwd: string, argv: Array<string>): Array<string> {
	const resolvedCwd = resolve(cwd);
	const directories: Array<string> = [];
	const seen = new Set<string>();

	for (const directory of walkUpQualifyingDirectoriesOf(resolvedCwd)) {
		pushUnique(directories, seen, directory);
	}

	for (const prefix of prefixValuesOf(argv)) {
		pushUnique(directories, seen, resolve(resolvedCwd, prefix));
	}

	return directories;
}

export function hiddenLockfileStatOf(directory: string): HiddenLockfileStat | undefined {
	const stats = statSync(join(directory, "node_modules", ".package-lock.json"), { throwIfNoEntry: false });

	if (stats === undefined) {
		return undefined;
	}

	return { mtimeMs: stats.mtimeMs, size: stats.size };
}

function walkUpQualifyingDirectoriesOf(start: string): Array<string> {
	const directories: Array<string> = [];
	let current = start;

	for (;;) {
		if (existsSync(join(current, "package.json")) || existsSync(join(current, "node_modules"))) {
			directories.push(current);
		}

		const parent = dirname(current);

		if (parent === current) {
			break;
		}

		current = parent;
	}

	return directories;
}

function prefixValuesOf(argv: Array<string>): Array<string> {
	const values: Array<string> = [];

	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];

		if (argument === undefined) {
			continue;
		}

		if (argument === "--prefix" || argument === "-C") {
			const value = argv[index + 1];

			if (value !== undefined) {
				values.push(value);
				index++;
			}

			continue;
		}

		if (argument.startsWith("--prefix=")) {
			values.push(argument.slice("--prefix=".length));

			continue;
		}

		if (argument.startsWith("-C=")) {
			values.push(argument.slice("-C=".length));
		}
	}

	return values;
}

function pushUnique(directories: Array<string>, seen: Set<string>, directory: string): void {
	const key = identityKeyOf(directory);

	if (seen.has(key)) {
		return;
	}

	seen.add(key);
	directories.push(directory);
}

function identityKeyOf(path: string): string {
	return process.platform === "win32" ? path.toLowerCase() : path;
}
