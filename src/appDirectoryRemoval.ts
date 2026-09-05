import { existsSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isAppDirectoryProcessPath } from "./appDirectoryProcessesOf";
import { isNpmPackageExecutable } from "./exposure";

export function isDisplacementRequired(
	executablePath: string,
	appDirectory: string,
	platform: NodeJS.Platform,
): boolean {
	if (platform !== "win32") {
		return false;
	}

	return isAppDirectoryProcessPath(executablePath, appDirectory, platform) || isNpmPackageExecutable(executablePath);
}

export function displaceRunningExecutable(executablePath: string, temporaryDirectory: string, pid: number): string {
	const displacedPath = join(temporaryDirectory, `znpm-uninstalled-${String(pid)}.exe`);

	try {
		renameSync(executablePath, displacedPath);
	} catch (error: unknown) {
		throw new Error(
			`znpm cannot move ${executablePath} to ${displacedPath}; set TEMP to a directory on the same volume, then run znpm uninstall again`,
			{ cause: error },
		);
	}

	return displacedPath;
}

export function removeAppDirectory(appDirectory: string): void {
	let removalError: unknown;

	try {
		rmSync(appDirectory, { recursive: true, force: true });
	} catch (error: unknown) {
		removalError = error;
	}

	if (!existsSync(appDirectory)) {
		return;
	}

	throw new Error(
		`znpm cannot remove ${survivingPathOf(appDirectory)}; close whatever holds it open, then remove ${appDirectory} by hand`,
		{ cause: removalError },
	);
}

function survivingPathOf(directory: string): string {
	for (const entry of entriesOf(directory)) {
		const entryPath = join(directory, entry.name);

		if (!entry.isDirectory()) {
			return entryPath;
		}

		const nested = survivingPathOf(entryPath);

		if (nested !== entryPath) {
			return nested;
		}
	}

	return directory;
}

function entriesOf(directory: string): Array<{ name: string; isDirectory: () => boolean }> {
	try {
		return readdirSync(directory, { withFileTypes: true });
	} catch {
		return [];
	}
}
