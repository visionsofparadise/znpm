import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { getStorePath } from "@pnpm/store-path";
import { finishWorkers } from "@pnpm/worker";
import {
	appDirectoryOf,
	binDirectoryOf,
	npmWrapperDirectoryOf,
	npmWrapperPathOf,
	readState,
	writeState,
	type PathChange,
} from "./appData";
import { runningAppDirectoryProcessesOf, uninstallBusyMessageOf } from "./appDirectoryProcessesOf";
import { npmPathOf } from "./npm";
import { pnpmAppDirectoryOf } from "./pnpmAppData";
import { pruneStoreDirectories } from "./prune";
import { storeDirectoryOverrideOf } from "./storeDirectoryOverrideOf";
import {
	applyWindowsMachinePath,
	applyWindowsUserPath,
	changesToReverseOf,
	insertPathEntry,
	npmCommandForwarder,
	placePosixSymlink,
	removeChanges,
	removePathEntry,
	removePathEntryIgnoringCase,
	removePosixSymlink,
	removePosixSymlinkPointingAt,
	upsertChange,
} from "./toggle";
import { quotedProcessArgumentOf } from "./utils/quotedProcessArgumentOf";
import { runCli } from "./utils/runCli";
import { setPnpmWorkerScriptPath } from "./utils/setPnpmWorkerScriptPath";
import { userArgumentsOf } from "./utils/userArgumentsOf";

const npmLinkPath = "/usr/local/bin/npm";
const znpmLinkPath = "/usr/local/bin/znpm";

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

function placeNpmCommandForwarder(appDirectory: string): void {
	const npmWrapperPath = npmWrapperPathOf(appDirectory);

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

function enable(): void {
	const appDirectory = appDirectoryOf(process.platform);
	const npmPath = npmPathOf(process.env, appDirectory);

	log(`using real npm at ${npmPath}`);
	placeNpmCommandForwarder(appDirectory);
	writeState(appDirectory, { ...readState(appDirectory), npmPath });
	applyToggleChanges(appDirectory);
	writeState(appDirectory, { ...readState(appDirectory), enabled: true });
}

function disable(): void {
	reverseRecordedChanges("disable");

	const appDirectory = appDirectoryOf(process.platform);

	writeState(appDirectory, { ...readState(appDirectory), enabled: false });
}

function uninstall(): void {
	const appDirectory = appDirectoryOf(process.platform);

	log("checking for running processes");

	const running = runningAppDirectoryProcessesOf(appDirectory);

	if (running.length > 0) {
		throw new Error(uninstallBusyMessageOf(running));
	}

	reverseRecordedChanges("uninstall");

	removeZnpmExposure(appDirectory);
	writeState(appDirectory, { ...readState(appDirectory), enabled: false });

	if (process.platform === "win32") {
		log(`removing ${appDirectory}`);
		scheduleWindowsAppDirectoryRemoval(appDirectory);

		return;
	}

	log(`removing ${appDirectory}`);
	rmSync(appDirectory, { recursive: true, force: true });
}

function applyToggleChanges(appDirectory: string): void {
	if (process.platform === "win32") {
		const npmWrapperDirectory = npmWrapperDirectoryOf(appDirectory);

		log(`prepending ${npmWrapperDirectory} to the machine PATH`);
		applyMachinePathElevated("insert", npmWrapperDirectory);
		recordChange(appDirectory, { target: "windowsMachinePath", entry: npmWrapperDirectory });

		return;
	}

	const npmWrapperPath = npmWrapperPathOf(appDirectory);

	log(`linking ${npmLinkPath} -> ${npmWrapperPath}`);
	placePosixSymlink(npmLinkPath, npmWrapperPath);
	recordChange(appDirectory, { target: "posixSymlink", path: npmLinkPath });
}

function removeZnpmExposure(appDirectory: string): void {
	if (process.platform === "win32") {
		const binDirectory = binDirectoryOf(appDirectory);

		log(`removing ${binDirectory} from the user PATH`);
		applyWindowsUserPath((pathValue) => removePathEntryIgnoringCase(pathValue, binDirectory, ";"));

		return;
	}

	const znpmPath = join(binDirectoryOf(appDirectory), "znpm");

	log(`removing ${znpmLinkPath}`);
	removePosixSymlinkPointingAt(znpmLinkPath, znpmPath);
}

function reverseRecordedChanges(scope: "disable" | "uninstall"): void {
	const appDirectory = appDirectoryOf(process.platform);
	const reversed = changesToReverseOf(readState(appDirectory).changes, scope);

	for (const change of reversed) {
		reverseChange(change);
		writeState(appDirectory, removeChanges(readState(appDirectory), [change]));
	}
}

function reverseChange(change: PathChange): void {
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
			removePosixSymlink(change.path);

			return;
		}
	}
}

function recordChange(appDirectory: string, change: PathChange): void {
	writeState(appDirectory, upsertChange(readState(appDirectory), change));
}

function applyMachinePath(insert: string | undefined, remove: string | undefined): void {
	if (insert !== undefined && remove === undefined) {
		applyWindowsMachinePath((pathValue) => insertPathEntry(pathValue, insert, ";"));

		return;
	}

	if (remove !== undefined && insert === undefined) {
		applyWindowsMachinePath((pathValue) => removePathEntry(pathValue, remove, ";"));

		return;
	}

	throw new Error("znpm apply-machine-path requires --insert <dir> or --remove <dir>");
}

function applyMachinePathElevated(action: "insert" | "remove", entry: string): void {
	const { filePath, argumentList } = reinvocationOf(["apply-machine-path", `--${action}`, entry]);
	const script = `$process = Start-Process -FilePath ${powershellSingleQuote(filePath)} -ArgumentList ${powershellStringArray(argumentList)} -Verb RunAs -Wait -PassThru
if ($null -eq $process) { exit 1 }
exit $process.ExitCode
`;
	const encoded = Buffer.from(script, "utf16le").toString("base64");
	const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
		stdio: "inherit",
	});

	if (result.error !== undefined) {
		throw result.error;
	}

	if (result.status !== 0) {
		throw new Error("znpm could not apply the machine PATH");
	}
}

function reinvocationOf(commandArguments: Array<string>): { filePath: string; argumentList: Array<string> } {
	const filePath = process.execPath;
	const scriptPath = process.argv[1];
	const runningFromScript =
		scriptPath !== undefined &&
		(scriptPath.endsWith(".ts") || scriptPath.endsWith(".js") || scriptPath.endsWith(".mjs"));

	if (runningFromScript) {
		return { filePath, argumentList: [...process.execArgv, resolve(scriptPath), ...commandArguments] };
	}

	return { filePath, argumentList: commandArguments };
}

function scheduleWindowsAppDirectoryRemoval(appDirectory: string): void {
	const scriptPath = join(tmpdir(), `znpm-uninstall-${String(process.pid)}.ps1`);
	const script = [
		"$ErrorActionPreference = 'SilentlyContinue'",
		`$target = ${powershellSingleQuote(appDirectory)}`,
		"for ($i = 0; $i -lt 30; $i++) {",
		"  Start-Sleep -Seconds 1",
		"  if (-not (Test-Path -LiteralPath $target)) { break }",
		"  Remove-Item -LiteralPath $target -Recurse -Force",
		"}",
		"Remove-Item -LiteralPath $PSCommandPath -Force",
		"",
	].join("\r\n");

	writeFileSync(scriptPath, script, "utf8");

	const child = spawn(
		"powershell.exe",
		["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
		{
			detached: true,
			stdio: "ignore",
			windowsHide: true,
		},
	);

	child.unref();
}

function runWithStatus(inProgress: string, complete: string, work: () => void): void {
	log(inProgress);
	work();
	log(complete);
}

function log(message: string): void {
	console.log(message);
}

function powershellSingleQuote(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function powershellStringArray(values: Array<string>): string {
	return `@(${values.map((value) => powershellSingleQuote(quotedProcessArgumentOf(value))).join(",")})`;
}
