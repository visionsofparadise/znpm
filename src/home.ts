import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type PathChange =
	| { target: "windowsMachinePath"; entry: string }
	| { target: "windowsUserPath"; entry: string }
	| { target: "posixSymlink"; path: string };

export interface State {
	enabled: boolean;
	changes: Array<PathChange>;
	realNpmPath: string | undefined;
}

export function homeDirectoryOf(platform: NodeJS.Platform): string {
	if (platform === "win32") {
		return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "znpm");
	}

	return join(homedir(), ".local", "share", "znpm");
}

export function binDirectoryOf(homeDirectory: string): string {
	return join(homeDirectory, "bin");
}

export function shimDirectoryOf(homeDirectory: string): string {
	return join(homeDirectory, "shim");
}

export function shadowPathOf(homeDirectory: string): string {
	return join(homeDirectory, process.platform === "win32" ? "npm.exe" : "npm");
}

export function readState(homeDirectory: string): State {
	const statePath = statePathOf(homeDirectory);

	if (!existsSync(statePath)) {
		return { enabled: false, changes: [], realNpmPath: undefined };
	}

	const parsed: unknown = JSON.parse(readFileSync(statePath, "utf8"));

	return stateOf(parsed);
}

export function writeState(homeDirectory: string, state: State): void {
	mkdirSync(homeDirectory, { recursive: true });

	writeFileSync(statePathOf(homeDirectory), `${JSON.stringify(state, undefined, "\t")}\n`, "utf8");
}

function statePathOf(homeDirectory: string): string {
	return join(homeDirectory, "state.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
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

	const { realNpmPath } = value;

	if (realNpmPath !== undefined && typeof realNpmPath !== "string") {
		throw new Error("znpm state.json is malformed");
	}

	return { enabled: value.enabled, changes: value.changes.map(pathChangeOf), realNpmPath };
}
