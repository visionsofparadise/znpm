import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { binDirectoryOf, npmWrapperDirectoryOf } from "./appData";
import { applyMachinePathElevated } from "./machinePath";
import {
	applyWindowsUserPath,
	hasWindowsMachinePathEntry,
	insertPathEntry,
	removePathEntryIgnoringCase,
} from "./toggle";

export function posixEnvScriptOf(appDirectory: string): string {
	return `znpm_home=${posixSingleQuote(appDirectory)}
case ":$PATH:" in
\t*":$znpm_home/npm-wrapper:"*) ;;
\t*) export PATH="$znpm_home/npm-wrapper:$znpm_home/bin:$PATH" ;;
esac
unset znpm_home
`;
}

export function posixFishEnvScriptOf(appDirectory: string): string {
	return `set -l znpm_home ${posixSingleQuote(appDirectory)}
if not contains "$znpm_home/npm-wrapper" $PATH
\tset -gx PATH "$znpm_home/npm-wrapper" "$znpm_home/bin" $PATH
end
`;
}

export function envFilePathOf(appDirectory: string): string {
	return join(appDirectory, "env");
}

export function fishEnvFilePathOf(appDirectory: string): string {
	return join(appDirectory, "env.fish");
}

export function startupSourceLineOf(appDirectory: string): string {
	return `. ${posixSingleQuote(envFilePathOf(appDirectory))}`;
}

export function startupFilesOf(homeDirectory: string): Array<{ path: string; createIfAbsent: boolean }> {
	return [
		{ path: join(homeDirectory, ".profile"), createIfAbsent: true },
		{ path: join(homeDirectory, ".bashrc"), createIfAbsent: true },
		{ path: join(homeDirectory, ".zshrc"), createIfAbsent: true },
		{ path: join(homeDirectory, ".bash_profile"), createIfAbsent: false },
		{ path: join(homeDirectory, ".zprofile"), createIfAbsent: false },
	];
}

export function fishStartupFilePathOf(homeDirectory: string): string {
	return join(fishConfigurationDirectoryOf(homeDirectory), "conf.d", "znpm.fish");
}

export function withStartupLine(content: string, line: string): string {
	if (content.split("\n").some((existing) => isStartupLine(existing, line))) {
		return content;
	}

	const separator = content !== "" && !content.endsWith("\n") ? "\n" : "";

	return `${content}${separator}${line}\n`;
}

export function withoutStartupLine(content: string, line: string): string {
	return content
		.split("\n")
		.filter((existing) => !isStartupLine(existing, line))
		.join("\n");
}

export function isNpmPackageExecutable(execPath: string): boolean {
	return execPath.replaceAll("\\", "/").includes("/node_modules/@zcross/znpm-");
}

export function ensureExposure(appDirectory: string, env: NodeJS.ProcessEnv): void {
	if (process.platform === "win32") {
		ensureWindowsExposure(appDirectory);

		return;
	}

	ensurePosixExposure(appDirectory, homeDirectoryOf(env));
}

export function removeExposure(appDirectory: string, env: NodeJS.ProcessEnv): void {
	if (process.platform === "win32") {
		removeWindowsExposure(appDirectory);

		return;
	}

	removePosixExposure(appDirectory, homeDirectoryOf(env));
}

function ensurePosixExposure(appDirectory: string, homeDirectory: string): void {
	mkdirSync(appDirectory, { recursive: true });
	writeFileSync(envFilePathOf(appDirectory), posixEnvScriptOf(appDirectory), "utf8");
	writeFileSync(fishEnvFilePathOf(appDirectory), posixFishEnvScriptOf(appDirectory), "utf8");

	const line = startupSourceLineOf(appDirectory);

	for (const startupFile of startupFilesOf(homeDirectory)) {
		const present = existsSync(startupFile.path);

		if (!present && !startupFile.createIfAbsent) {
			continue;
		}

		const content = present ? readFileSync(startupFile.path, "utf8") : "";
		const updated = withStartupLine(content, line);

		if (updated === content) {
			continue;
		}

		mkdirSync(dirname(startupFile.path), { recursive: true });
		writeFileSync(startupFile.path, updated, "utf8");
	}

	if (!existsSync(fishConfigurationDirectoryOf(homeDirectory))) {
		return;
	}

	const fishStartupFilePath = fishStartupFilePathOf(homeDirectory);

	mkdirSync(dirname(fishStartupFilePath), { recursive: true });
	writeFileSync(fishStartupFilePath, posixFishEnvScriptOf(appDirectory), "utf8");
}

function removePosixExposure(appDirectory: string, homeDirectory: string): void {
	const line = startupSourceLineOf(appDirectory);

	for (const startupFile of startupFilesOf(homeDirectory)) {
		if (!existsSync(startupFile.path)) {
			continue;
		}

		const content = readFileSync(startupFile.path, "utf8");
		const updated = withoutStartupLine(content, line);

		if (updated === content) {
			continue;
		}

		writeFileSync(startupFile.path, updated, "utf8");
	}

	rmSync(fishStartupFilePathOf(homeDirectory), { force: true });
}

function ensureWindowsExposure(appDirectory: string): void {
	const binDirectory = binDirectoryOf(appDirectory);
	const npmWrapperDirectory = npmWrapperDirectoryOf(appDirectory);

	if (existsSync(join(binDirectory, "znpm.exe"))) {
		applyWindowsUserPath((pathValue) => insertPathEntry(pathValue, binDirectory, ";"));
	}

	if (!hasWindowsMachinePathEntry(npmWrapperDirectory)) {
		applyMachinePathElevated("insert", npmWrapperDirectory);
	}
}

function removeWindowsExposure(appDirectory: string): void {
	const binDirectory = binDirectoryOf(appDirectory);
	const npmWrapperDirectory = npmWrapperDirectoryOf(appDirectory);

	applyWindowsUserPath((pathValue) => removePathEntryIgnoringCase(pathValue, binDirectory, ";"));

	if (hasWindowsMachinePathEntry(npmWrapperDirectory)) {
		applyMachinePathElevated("remove", npmWrapperDirectory);
	}
}

function isStartupLine(existing: string, line: string): boolean {
	return existing.replace(/\r$/, "") === line;
}

function fishConfigurationDirectoryOf(homeDirectory: string): string {
	return join(homeDirectory, ".config", "fish");
}

function homeDirectoryOf(env: NodeJS.ProcessEnv): string {
	if (process.platform !== "win32" && env.HOME !== undefined && env.HOME !== "") {
		return env.HOME;
	}

	return homedir();
}

function posixSingleQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}
