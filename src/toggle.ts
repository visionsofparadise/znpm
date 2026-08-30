import { spawnSync } from "node:child_process";
import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { basename } from "node:path";
import { isRecord } from "./utils/isRecord";
import { runPowerShell } from "./utils/runPowerShell";
import type { PathChange, State } from "./appData";

export const npmCommandForwarder = '@echo off\r\n"%~dp0npm.exe" %*\r\nexit /b %ERRORLEVEL%\r\n';

export function insertPathEntry(pathValue: string, entry: string, separator: string): string {
	const entries = pathValue === "" ? [] : pathValue.split(separator);

	if (entries.includes(entry)) {
		return pathValue;
	}

	return [entry, ...entries].join(separator);
}

export function removePathEntry(pathValue: string, entry: string, separator: string): string {
	return removeMatchingPathEntries(pathValue, separator, (existing) => existing === entry);
}

export function removePathEntryIgnoringCase(pathValue: string, entry: string, separator: string): string {
	const lowercased = entry.toLowerCase();

	return removeMatchingPathEntries(pathValue, separator, (existing) => existing.toLowerCase() === lowercased);
}

function removeMatchingPathEntries(pathValue: string, separator: string, matches: (entry: string) => boolean): string {
	const entries = pathValue === "" ? [] : pathValue.split(separator);

	return entries.filter((existing) => !matches(existing)).join(separator);
}

function npmFacingChangesOf(changes: Array<PathChange>): Array<PathChange> {
	return changes.filter(isNpmFacingChange);
}

export function changesToReverseOf(changes: Array<PathChange>, scope: "disable" | "uninstall"): Array<PathChange> {
	return scope === "uninstall" ? changes : npmFacingChangesOf(changes);
}

export function upsertChange(state: State, change: PathChange): State {
	const key = pathChangeKeyOf(change);

	return { ...state, changes: [...state.changes.filter((existing) => pathChangeKeyOf(existing) !== key), change] };
}

export function removeChanges(state: State, removed: Array<PathChange>): State {
	const keys = new Set(removed.map(pathChangeKeyOf));

	return { ...state, changes: state.changes.filter((change) => !keys.has(pathChangeKeyOf(change))) };
}

export function applyWindowsMachinePath(transform: (pathValue: string) => string): void {
	applyWindowsRegistryPath("machine", transform);
}

export function applyWindowsUserPath(transform: (pathValue: string) => string): void {
	applyWindowsRegistryPath("user", transform);
}

export interface PosixSymlinkInspection {
	exists: boolean;
	isSymbolicLink: boolean;
	linkTargetPath: string | undefined;
	resolvedLinkPath: string | undefined;
}

export function isSymlinkPointingAt(
	inspection: PosixSymlinkInspection,
	targetPath: string,
	resolvedTargetPath: string | undefined,
): boolean {
	if (!inspection.exists || !inspection.isSymbolicLink) {
		return false;
	}

	if (inspection.linkTargetPath === targetPath) {
		return true;
	}

	return inspection.resolvedLinkPath !== undefined && inspection.resolvedLinkPath === resolvedTargetPath;
}

export function placePosixSymlink(linkPath: string, targetPath: string): void {
	const inspection = posixSymlinkInspectionOf(linkPath);

	if (!inspection.exists) {
		runSudo(["ln", "-s", targetPath, linkPath]);

		return;
	}

	if (isSymlinkPointingAt(inspection, targetPath, resolvedPathOf(targetPath))) {
		return;
	}

	throw new Error(`znpm found ${linkPath} that it did not create`);
}

export function removePosixSymlink(linkPath: string): void {
	if (!posixSymlinkInspectionOf(linkPath).exists) {
		return;
	}

	runSudo(["rm", "-f", linkPath]);
}

export function removePosixSymlinkPointingAt(linkPath: string, targetPath: string): void {
	if (!isSymlinkPointingAt(posixSymlinkInspectionOf(linkPath), targetPath, resolvedPathOf(targetPath))) {
		return;
	}

	runSudo(["rm", "-f", linkPath]);
}

function isNpmFacingChange(change: PathChange): boolean {
	if (change.target === "windowsMachinePath") {
		return true;
	}

	if (change.target === "posixSymlink") {
		return basename(change.path) === "npm";
	}

	return false;
}

function pathChangeKeyOf(change: PathChange): string {
	return change.target === "posixSymlink" ? `${change.target}:${change.path}` : `${change.target}:${change.entry}`;
}

function applyWindowsRegistryPath(scope: "machine" | "user", transform: (pathValue: string) => string): void {
	const current = readWindowsRegistryPath(scope);
	const transformed = transform(current.value);

	if (transformed === current.value) {
		return;
	}

	writeWindowsRegistryPath(scope, transformed, current.kind);
}

function readWindowsRegistryPath(scope: "machine" | "user"): { value: string; kind: number } {
	const script = `${registryScopeScriptOf(scope)}
$key = $root.OpenSubKey($subKey, $false)
if ($null -eq $key) { throw "znpm could not open the $scope PATH key" }
try {
  if (-not ($key.GetValueNames() | Where-Object { $_ -ieq "Path" })) {
    @{ kind = 2; value = "" } | ConvertTo-Json -Compress
  } else {
    $kind = [int]$key.GetValueKind("Path")
    $raw = $key.GetValue("Path", "", [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    if ($null -eq $raw) { $value = "" }
    elseif ($raw -is [string[]]) { $value = ($raw -join ";") }
    else { $value = [string]$raw }
    @{ kind = $kind; value = $value } | ConvertTo-Json -Compress
  }
} finally {
  $key.Close()
}
`;
	const parsed: unknown = JSON.parse(
		runPowerShell(script)
			.replace(/^\uFEFF/, "")
			.trim(),
	);

	if (!isRecord(parsed) || typeof parsed.value !== "string" || typeof parsed.kind !== "number") {
		throw new Error("znpm could not read the Windows PATH");
	}

	return { value: parsed.value, kind: parsed.kind };
}

function writeWindowsRegistryPath(scope: "machine" | "user", value: string, kind: number): void {
	const valueBase64 = Buffer.from(value, "utf8").toString("base64");
	const script = `${registryScopeScriptOf(scope)}
$kind = ${kind}
$value = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String(${powershellSingleQuote(valueBase64)}))
$key = $root.OpenSubKey($subKey, $true)
if ($null -eq $key) { throw "znpm could not open the $scope PATH key for write" }
try {
  $key.SetValue("Path", $value, [Microsoft.Win32.RegistryValueKind]$kind)
} finally {
  $key.Close()
}
if (-not ("EnvironmentNative" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class EnvironmentNative {
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
}
"@
}
$result = [UIntPtr]::Zero
[EnvironmentNative]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, "Environment", 2, 5000, [ref]$result) | Out-Null
`;

	runPowerShell(script);
}

function registryScopeScriptOf(scope: "machine" | "user"): string {
	if (scope === "machine") {
		return `$root = [Microsoft.Win32.Registry]::LocalMachine
$subKey = "SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment"`;
	}

	return `$root = [Microsoft.Win32.Registry]::CurrentUser
$subKey = "Environment"`;
}

function runSudo(commandArguments: Array<string>): void {
	const result = spawnSync("sudo", commandArguments, { stdio: "inherit" });

	if (result.error !== undefined) {
		throw result.error;
	}

	if (result.status !== 0) {
		throw new Error(`znpm sudo ${commandArguments.join(" ")} failed`);
	}
}

function posixSymlinkInspectionOf(linkPath: string): PosixSymlinkInspection {
	const stats = lstatSync(linkPath, { throwIfNoEntry: false });

	if (stats === undefined) {
		return { exists: false, isSymbolicLink: false, linkTargetPath: undefined, resolvedLinkPath: undefined };
	}

	if (!stats.isSymbolicLink()) {
		return { exists: true, isSymbolicLink: false, linkTargetPath: undefined, resolvedLinkPath: undefined };
	}

	return {
		exists: true,
		isSymbolicLink: true,
		linkTargetPath: readlinkSync(linkPath),
		resolvedLinkPath: resolvedPathOf(linkPath),
	};
}

function resolvedPathOf(path: string): string | undefined {
	try {
		return realpathSync(path);
	} catch {
		return undefined;
	}
}

function powershellSingleQuote(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}
