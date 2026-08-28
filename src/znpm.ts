import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { getStorePath } from "@pnpm/store-path";
import {
	applyWindowsMachinePath,
	applyWindowsUserPath,
	changesToReverseOf,
	insertPathEntry,
	npmCommandForwarder,
	placePosixSymlink,
	removeChanges,
	removePathEntry,
	removePosixSymlink,
	upsertChange,
} from "./enablement";
import {
	binDirectoryOf,
	homeDirectoryOf,
	readState,
	shadowPathOf,
	shimDirectoryOf,
	writeState,
	type PathChange,
} from "./home";
import { pnpmHomeDirectoryOf } from "./pnpmHome";
import { pruneStoreDirectories } from "./prune";
import { realNpmPathOf } from "./realNpm";
import { storeDirectoryOverrideOf } from "./storeDirectoryOverrideOf";
import { quotedProcessArgumentOf } from "./utils/quotedProcessArgumentOf";
import { runCli } from "./utils/runCli";
import { setPnpmWorkerScriptPath } from "./utils/setPnpmWorkerScriptPath";
import { userArgumentsOf } from "./utils/userArgumentsOf";
import { volumeStoreDirectoriesOf } from "./volumeStores";

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
		case "place-shim": {
			placeShim();

			return;
		}

		case "enable": {
			enable();

			return;
		}

		case "disable": {
			disable();

			return;
		}

		case "uninstall": {
			uninstall();

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
	const override = storeDirectoryOverrideOf(process.env);

	if (override !== undefined) {
		const storeDirectory = await getStorePath({
			pkgRoot: process.cwd(),
			storePath: override,
			pnpmHomeDir: pnpmHomeDirectoryOf(process.env, process.platform),
		});

		await pruneStoreDirectories([storeDirectory]);

		return;
	}

	await pruneStoreDirectories(volumeStoreDirectoriesOf(process.env, process.platform));
}

function placeShim(): void {
	const homeDirectory = homeDirectoryOf(process.platform);
	const shadowPath = shadowPathOf(homeDirectory);

	mkdirSync(homeDirectory, { recursive: true });
	mkdirSync(binDirectoryOf(homeDirectory), { recursive: true });

	if (!existsSync(shadowPath)) {
		throw new Error(`znpm found no shadow binary at ${shadowPath}`);
	}

	if (process.platform !== "win32") {
		return;
	}

	const shimDirectory = shimDirectoryOf(homeDirectory);

	mkdirSync(shimDirectory, { recursive: true });
	copyFileSync(shadowPath, join(shimDirectory, "npm.exe"));
	writeFileSync(join(shimDirectory, "npm.cmd"), npmCommandForwarder, "utf8");
}

function enable(): void {
	const homeDirectory = homeDirectoryOf(process.platform);
	const realNpmPath = realNpmPathOf(process.env, homeDirectory);

	placeShim();
	writeState(homeDirectory, { ...readState(homeDirectory), realNpmPath });
	applyEnablementChanges(homeDirectory);
	writeState(homeDirectory, { ...readState(homeDirectory), enabled: true });
}

function disable(): void {
	reverseRecordedChanges("disable");

	const homeDirectory = homeDirectoryOf(process.platform);

	writeState(homeDirectory, { ...readState(homeDirectory), enabled: false });
}

function uninstall(): void {
	reverseRecordedChanges("uninstall");

	const homeDirectory = homeDirectoryOf(process.platform);

	writeState(homeDirectory, { ...readState(homeDirectory), enabled: false });

	if (process.platform === "win32") {
		scheduleWindowsHomeRemoval(homeDirectory);

		return;
	}

	rmSync(homeDirectory, { recursive: true, force: true });
}

function applyEnablementChanges(homeDirectory: string): void {
	if (process.platform === "win32") {
		const shimDirectory = shimDirectoryOf(homeDirectory);
		const binDirectory = binDirectoryOf(homeDirectory);

		applyMachinePathElevated("insert", shimDirectory);
		recordChange(homeDirectory, { target: "windowsMachinePath", entry: shimDirectory });
		applyWindowsUserPath((pathValue) => insertPathEntry(pathValue, binDirectory, ";"));
		recordChange(homeDirectory, { target: "windowsUserPath", entry: binDirectory });

		return;
	}

	const npmLinkPath = "/usr/local/bin/npm";
	const znpmLinkPath = "/usr/local/bin/znpm";
	const znpmPath = join(binDirectoryOf(homeDirectory), "znpm");

	placePosixSymlink(npmLinkPath, shadowPathOf(homeDirectory));
	recordChange(homeDirectory, { target: "posixSymlink", path: npmLinkPath });
	placePosixSymlink(znpmLinkPath, znpmPath);
	recordChange(homeDirectory, { target: "posixSymlink", path: znpmLinkPath });
}

function reverseRecordedChanges(scope: "disable" | "uninstall"): void {
	const homeDirectory = homeDirectoryOf(process.platform);
	const reversed = changesToReverseOf(readState(homeDirectory).changes, scope);

	for (const change of reversed) {
		reverseChange(change);
		writeState(homeDirectory, removeChanges(readState(homeDirectory), [change]));
	}
}

function reverseChange(change: PathChange): void {
	switch (change.target) {
		case "windowsMachinePath": {
			applyMachinePathElevated("remove", change.entry);

			return;
		}

		case "windowsUserPath": {
			applyWindowsUserPath((pathValue) => removePathEntry(pathValue, change.entry, ";"));

			return;
		}

		case "posixSymlink": {
			removePosixSymlink(change.path);

			return;
		}
	}
}

function recordChange(homeDirectory: string, change: PathChange): void {
	writeState(homeDirectory, upsertChange(readState(homeDirectory), change));
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

function scheduleWindowsHomeRemoval(homeDirectory: string): void {
	const scriptPath = join(tmpdir(), `znpm-uninstall-${String(process.pid)}.ps1`);
	const script = `$processId = ${process.pid}
$homeDirectory = ${powershellSingleQuote(homeDirectory)}
while (Get-Process -Id $processId -ErrorAction SilentlyContinue) {
  Start-Sleep -Milliseconds 250
}
Remove-Item -LiteralPath $homeDirectory -Recurse -Force
Remove-Item -LiteralPath ${powershellSingleQuote(scriptPath)} -Force -ErrorAction SilentlyContinue
`;

	writeFileSync(scriptPath, script, "utf8");

	const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", scriptPath], {
		detached: true,
		stdio: "ignore",
		windowsHide: true,
	});

	child.unref();
}

function powershellSingleQuote(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function powershellStringArray(values: Array<string>): string {
	return `@(${values.map((value) => powershellSingleQuote(quotedProcessArgumentOf(value))).join(",")})`;
}
