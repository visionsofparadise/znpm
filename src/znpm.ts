import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readlinkSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { getStorePath } from "@pnpm/store-path";
import { finishWorkers } from "@pnpm/worker";
import {
	appDirectoryOf,
	npmWrapperDirectoryOf,
	npmWrapperPathOf,
	readState,
	writeState,
	type PathChange,
} from "./appData";
import { runningAppDirectoryProcessesOf, uninstallBusyMessageOf } from "./appDirectoryProcessesOf";
import { displaceRunningExecutable, isDisplacementRequired, removeAppDirectory } from "./appDirectoryRemoval";
import { ensureExposure, isNpmPackageExecutable, removeExposure } from "./exposure";
import { applyMachinePathElevated } from "./machinePath";
import { npmPathOf, resolveNpm } from "./npm";
import { pnpmAppDirectoryOf } from "./pnpmAppData";
import { pruneStoreDirectories } from "./prune";
import { storeDirectoryOverrideOf } from "./storeDirectoryOverrideOf";
import {
	applyWindowsMachinePath,
	applyWindowsUserPath,
	insertPathEntry,
	npmCommandForwarder,
	removeChanges,
	removePathEntry,
	removePathEntryIgnoringCase,
} from "./toggle";
import { isRecord } from "./utils/isRecord";
import { runCli } from "./utils/runCli";
import { setPnpmWorkerScriptPath } from "./utils/setPnpmWorkerScriptPath";
import { userArgumentsOf } from "./utils/userArgumentsOf";

setPnpmWorkerScriptPath();
await runCli(main);

function main(): void | Promise<void> {
	const userArguments = userArgumentsOf(process.argv, import.meta.url);
	const { values, positionals } = parseArgs({
		args: userArguments,
		allowPositionals: true,
		options: {
			insert: { type: "string" },
			remove: { type: "string" },
		},
	});
	const [command] = positionals;

	switch (command) {
		case "enable": {
			runWithStatus("enabling...", "enabled", enable);

			return;
		}

		case "disable": {
			runWithStatus("disabling...", "disabled", disable);

			return;
		}

		case "uninstall": {
			runWithStatus("uninstalling...", "uninstalled", uninstall);

			return;
		}

		case "apply-machine-path": {
			applyMachinePath(values.insert, values.remove);

			return;
		}

		case "gc": {
			return gc();
		}

		case undefined: {
			throw new Error("znpm requires a command");
		}

		default: {
			throw new Error(`znpm has no command ${command}`);
		}
	}
}

async function gc(): Promise<void> {
	const storeDirectory = await getStorePath({
		pkgRoot: process.cwd(),
		storePath: storeDirectoryOverrideOf(process.env),
		pnpmHomeDir: pnpmAppDirectoryOf(process.env, process.platform),
	});

	if (!existsSync(storeDirectory)) {
		return;
	}

	try {
		await pruneStoreDirectories([storeDirectory]);
	} finally {
		await finishWorkers();
	}
}

function npmWrapperSourcePathOf(execPath: string): string {
	return join(dirname(execPath), process.platform === "win32" ? "npm-wrapper.exe" : "npm-wrapper");
}

function placeNpmWrapper(appDirectory: string): void {
	const npmWrapperPath = npmWrapperPathOf(appDirectory);
	const sourcePath = npmWrapperSourcePathOf(process.execPath);

	if (existsSync(sourcePath) && !isPlacedBinaryCurrent(sourcePath, npmWrapperPath)) {
		log(`placing ${npmWrapperPath}`);
		mkdirSync(dirname(npmWrapperPath), { recursive: true });
		copyFileSync(sourcePath, npmWrapperPath);
		chmodSync(npmWrapperPath, 0o755);
	}

	if (!existsSync(npmWrapperPath)) {
		throw new Error(`znpm found no npm wrapper binary at ${npmWrapperPath}`);
	}

	if (process.platform !== "win32") {
		return;
	}

	const npmCommandPath = join(npmWrapperDirectoryOf(appDirectory), "npm.cmd");

	log(`writing ${npmCommandPath}`);
	writeFileSync(npmCommandPath, npmCommandForwarder, "utf8");
}

function isPlacedBinaryCurrent(sourcePath: string, placedPath: string): boolean {
	const placed = statSync(placedPath, { throwIfNoEntry: false });

	if (placed?.size !== statSync(sourcePath).size) {
		return false;
	}

	return sha256Of(sourcePath) === sha256Of(placedPath);
}

function sha256Of(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function enable(): void {
	const appDirectory = appDirectoryOf(process.env, process.platform);

	placeNpmWrapper(appDirectory);
	log("placing the PATH exposure");
	ensureExposure(appDirectory, process.env);

	const npmPath = npmPathOf(process.env, appDirectory);

	log(`using real npm at ${npmPath}`);
	writeState(appDirectory, { ...readState(appDirectory), npmPath, enabled: true });
}

function disable(): void {
	const appDirectory = appDirectoryOf(process.env, process.platform);

	writeState(appDirectory, { ...readState(appDirectory), enabled: false });
}

function uninstall(): void {
	const appDirectory = appDirectoryOf(process.env, process.platform);

	log("checking for running processes");

	const running = runningAppDirectoryProcessesOf(appDirectory);

	if (running.length > 0) {
		throw new Error(uninstallBusyMessageOf(running));
	}

	writeState(appDirectory, { ...readState(appDirectory), enabled: false });

	const npmRemoval = npmPackageRemovalOf(appDirectory);

	reverseRecordedChanges(appDirectory);
	log("removing the PATH exposure");
	removeExposure(appDirectory, process.env);

	if (isDisplacementRequired(process.execPath, appDirectory, process.platform)) {
		const displacedPath = displaceRunningExecutable(process.execPath, tmpdir(), process.pid);

		log(`moved this executable to ${displacedPath}`);
	}

	log(`removing ${appDirectory}`);
	removeAppDirectory(appDirectory);

	if (npmRemoval !== undefined) {
		log(`removing @zcross/znpm with ${npmRemoval.command}`);

		const result = spawnSync(npmRemoval.command, npmRemoval.args, {
			stdio: "inherit",
			env: { ...process.env, ZNPM_DISABLE: "1" },
		});

		if (result.error !== undefined) {
			throw new Error(`znpm could not run ${npmRemoval.command} to remove @zcross/znpm`, { cause: result.error });
		}

		if (result.status !== 0) {
			throw new Error(
				`znpm left @zcross/znpm installed: ${npmRemoval.command} exited ${String(result.status)}; run npm rm -g @zcross/znpm by hand`,
			);
		}
	}
}

function npmPackageRemovalOf(appDirectory: string): { command: string; args: Array<string> } | undefined {
	if (!isNpmPackageExecutable(process.execPath)) {
		return undefined;
	}

	const npm = resolveNpm({ ...process.env, ZNPM_DISABLE: "1" }, appDirectory);

	return { command: npm.command, args: [...npm.argsPrefix, "rm", "-g", "@zcross/znpm"] };
}

function reverseRecordedChanges(appDirectory: string): void {
	for (const change of readState(appDirectory).changes) {
		reverseChange(change, appDirectory);
		writeState(appDirectory, removeChanges(readState(appDirectory), [change]));
	}
}

function reverseChange(change: PathChange, appDirectory: string): void {
	switch (change.target) {
		case "windowsMachinePath": {
			log(`removing ${change.entry} from the machine PATH`);
			applyMachinePathElevated("remove", change.entry);

			return;
		}

		case "windowsUserPath": {
			log(`removing ${change.entry} from the user PATH`);
			applyWindowsUserPath((pathValue) => removePathEntry(pathValue, change.entry, ";"));

			return;
		}

		case "posixSymlink": {
			log(`removing ${change.path}`);
			removeLegacyPosixSymlink(change.path, appDirectory);

			return;
		}
	}
}

function removeLegacyPosixSymlink(linkPath: string, appDirectory: string): void {
	const stats = lstatSync(linkPath, { throwIfNoEntry: false });

	if (stats === undefined || !stats.isSymbolicLink() || !readlinkSync(linkPath).startsWith(appDirectory)) {
		return;
	}

	try {
		unlinkSync(linkPath);
	} catch (error: unknown) {
		if (isPermissionError(error)) {
			console.error(`znpm cannot remove ${linkPath}; remove it, then run znpm uninstall again`);
		}

		throw error;
	}
}

function isPermissionError(error: unknown): boolean {
	if (!isRecord(error)) {
		return false;
	}

	return error.code === "EACCES" || error.code === "EPERM";
}

function applyMachinePath(insert: string | undefined, remove: string | undefined): void {
	if (insert !== undefined && remove === undefined) {
		applyWindowsMachinePath((pathValue) => insertPathEntry(pathValue, insert, ";"));

		return;
	}

	if (remove !== undefined && insert === undefined) {
		applyWindowsMachinePath((pathValue) => removePathEntryIgnoringCase(pathValue, remove, ";"));

		return;
	}

	throw new Error("znpm apply-machine-path requires --insert <dir> or --remove <dir>");
}

function runWithStatus(inProgress: string, complete: string, work: () => void): void {
	log(inProgress);
	work();
	log(complete);
}

function log(message: string): void {
	console.log(message);
}
