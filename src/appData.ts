import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isRecord } from "./utils/isRecord";

export type PathChange =
	| { target: "windowsMachinePath"; entry: string }
	| { target: "windowsUserPath"; entry: string }
	| { target: "posixSymlink"; path: string };

export interface State {
	enabled: boolean;
	changes: Array<PathChange>;
	npmPath: string | undefined;
}

export function appDirectoryOf(platform: NodeJS.Platform): string {
	if (platform === "win32") {
		return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "znpm");
	}

	return join(homedir(), ".local", "share", "znpm");
}

export function binDirectoryOf(appDirectory: string): string {
	return join(appDirectory, "bin");
}

export function npmWrapperDirectoryOf(appDirectory: string): string {
	return join(appDirectory, "npm-wrapper");
}

export function npmWrapperPathOf(appDirectory: string): string {
	return join(npmWrapperDirectoryOf(appDirectory), process.platform === "win32" ? "npm.exe" : "npm");
}

export function readState(appDirectory: string): State {
	const statePath = statePathOf(appDirectory);

	if (!existsSync(statePath)) {
		return { enabled: false, changes: [], npmPath: undefined };
	}

	const parsed: unknown = JSON.parse(readFileSync(statePath, "utf8"));

	return stateOf(parsed);
}

export function writeState(appDirectory: string, state: State): void {
	mkdirSync(appDirectory, { recursive: true });

	writeFileSync(statePathOf(appDirectory), `${JSON.stringify(state, undefined, "\t")}\n`, "utf8");
}

function statePathOf(appDirectory: string): string {
	return join(appDirectory, "state.json");
}

function pathChangeOf(value: unknown): PathChange {
	if (isRecord(value)) {
		const { target, entry, path } = value;

		if ((target === "windowsMachinePath" || target === "windowsUserPath") && typeof entry === "string") {
			return { target, entry };
		}

		if (target === "posixSymlink" && typeof path === "string") {
			return { target, path };
		}
	}

	throw new Error("znpm state.json records a change that cannot be reversed");
}

function stateOf(value: unknown): State {
	if (!isRecord(value) || typeof value.enabled !== "boolean" || !Array.isArray(value.changes)) {
		throw new Error("znpm state.json is malformed");
	}

	const { npmPath } = value;

	if (npmPath !== undefined && typeof npmPath !== "string") {
		throw new Error("znpm state.json is malformed");
	}

	return { enabled: value.enabled, changes: value.changes.map(pathChangeOf), npmPath };
}
