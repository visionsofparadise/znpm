import { spawnSync } from "node:child_process";
import { readdirSync, readlinkSync, realpathSync } from "node:fs";
import { runPowerShell } from "./utils/runPowerShell";

export interface ProcessExecutable {
	pid: number;
	path: string;
}

export function runningAppDirectoryProcessesOf(appDirectory: string): Array<ProcessExecutable> {
	return appDirectoryProcessesOf(
		listedProcessExecutablesOf(appDirectory),
		appDirectory,
		process.pid,
		process.platform,
	);
}

export function appDirectoryProcessesOf(
	processes: Array<ProcessExecutable>,
	appDirectory: string,
	currentPid: number,
	platform: NodeJS.Platform,
): Array<ProcessExecutable> {
	const seen = new Set<number>();
	const kept: Array<ProcessExecutable> = [];

	for (const processExecutable of processes) {
		if (processExecutable.pid === currentPid || seen.has(processExecutable.pid)) {
			continue;
		}

		if (!isAppDirectoryProcessPath(processExecutable.path, appDirectory, platform)) {
			continue;
		}

		seen.add(processExecutable.pid);
		kept.push(processExecutable);
	}

	return kept.sort((left, right) => left.pid - right.pid);
}

export function isAppDirectoryProcessPath(
	executablePath: string,
	appDirectory: string,
	platform: NodeJS.Platform,
): boolean {
	if (isNormalizedInside(executablePath, appDirectory, platform)) {
		return true;
	}

	try {
		const resolvedExecutable = realpathSync(executablePath);
		let resolvedApp = appDirectory;

		try {
			resolvedApp = realpathSync(appDirectory);
		} catch {
			resolvedApp = appDirectory;
		}

		return isNormalizedInside(resolvedExecutable, resolvedApp, platform);
	} catch {
		return false;
	}
}

export function uninstallBusyMessageOf(processes: Array<ProcessExecutable>): string {
	return processes
		.map(
			(processExecutable) =>
				`znpm uninstall: process ${String(processExecutable.pid)} is still running: ${processExecutable.path}`,
		)
		.join("\n");
}

function listedProcessExecutablesOf(appDirectory: string): Array<ProcessExecutable> {
	if (process.platform === "win32") {
		return listedWindowsProcessExecutables();
	}

	if (process.platform === "linux") {
		return listedLinuxProcessExecutables();
	}

	return [...listedLsofProcessExecutables(appDirectory), ...listedPsProcessExecutables()];
}

function listedWindowsProcessExecutables(): Array<ProcessExecutable> {
	const stdout = runPowerShell(
		`Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path } | ForEach-Object { '{0} {1}' -f $_.Id, $_.Path }`,
	);

	return processExecutablesFromPidPrefixedLines(stdout);
}

function listedLinuxProcessExecutables(): Array<ProcessExecutable> {
	const processes: Array<ProcessExecutable> = [];

	for (const entry of readdirSync("/proc")) {
		if (!/^\d+$/.test(entry)) {
			continue;
		}

		try {
			processes.push({ pid: Number(entry), path: readlinkSync(`/proc/${entry}/exe`) });
		} catch {
			continue;
		}
	}

	return processes;
}

function listedLsofProcessExecutables(appDirectory: string): Array<ProcessExecutable> {
	const result = spawnSync("lsof", ["-nP", "-F", "pn", "+D", appDirectory], { encoding: "utf8" });

	if (result.error !== undefined) {
		throw result.error;
	}

	if (result.status !== 0 && result.status !== 1) {
		throw new Error("znpm could not list running processes");
	}

	return processExecutablesFromLsof(result.stdout);
}

function listedPsProcessExecutables(): Array<ProcessExecutable> {
	const result = spawnSync("ps", ["-axww", "-o", "pid=,command="], {
		encoding: "utf8",
		env: { ...process.env, COLUMNS: "2048" },
	});

	if (result.error !== undefined) {
		throw result.error;
	}

	if (result.status !== 0) {
		throw new Error("znpm could not list running processes");
	}

	return processExecutablesFromPidPrefixedLines(result.stdout).map((processExecutable) => {
		const [executable] = processExecutable.path.split(" ");

		return { pid: processExecutable.pid, path: executable ?? processExecutable.path };
	});
}

function processExecutablesFromLsof(stdout: string): Array<ProcessExecutable> {
	const processes: Array<ProcessExecutable> = [];
	let pid: number | undefined;

	for (const line of stdout.split(/\r?\n/)) {
		if (line.startsWith("p")) {
			pid = Number(line.slice(1));

			continue;
		}

		if (pid === undefined || !Number.isInteger(pid) || !line.startsWith("n")) {
			continue;
		}

		const path = line.slice(1);

		if (path !== "") {
			processes.push({ pid, path });
		}
	}

	return processes;
}

function processExecutablesFromPidPrefixedLines(stdout: string): Array<ProcessExecutable> {
	const processes: Array<ProcessExecutable> = [];

	for (const line of stdout.split(/\r?\n/)) {
		const trimmed = line.trim();

		if (trimmed === "") {
			continue;
		}

		const separator = trimmed.indexOf(" ");

		if (separator === -1) {
			continue;
		}

		const pid = Number(trimmed.slice(0, separator));
		const path = trimmed.slice(separator + 1);

		if (!Number.isInteger(pid) || path === "") {
			continue;
		}

		processes.push({ pid, path });
	}

	return processes;
}

function isNormalizedInside(value: string, appDirectory: string, platform: NodeJS.Platform): boolean {
	const app = normalizedPathOf(appDirectory, platform);
	const candidate = normalizedPathOf(value, platform);
	const separator = platform === "win32" ? "\\" : "/";

	return candidate === app || candidate.startsWith(`${app}${separator}`);
}

function normalizedPathOf(value: string, platform: NodeJS.Platform): string {
	const separator = platform === "win32" ? "\\" : "/";
	const other = platform === "win32" ? "/" : "\\";
	const replaced = value.split(other).join(separator);
	const trimmed = replaced.endsWith(separator) ? replaced.slice(0, -1) : replaced;

	return platform === "win32" ? trimmed.toLowerCase() : trimmed;
}
