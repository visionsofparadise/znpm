import { isRecord } from "./utils/isRecord";
import { powershellSingleQuote } from "./utils/powershellSingleQuote";
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
	return removeMatchingPathEntries(pathValue, separator, matchesIgnoringCase(entry));
}

export function hasPathEntryIgnoringCase(pathValue: string, entry: string, separator: string): boolean {
	return pathValue.split(separator).some(matchesIgnoringCase(entry));
}

function matchesIgnoringCase(entry: string): (existing: string) => boolean {
	const lowercased = entry.toLowerCase();

	return (existing) => existing.toLowerCase() === lowercased;
}

function removeMatchingPathEntries(pathValue: string, separator: string, matches: (entry: string) => boolean): string {
	const entries = pathValue === "" ? [] : pathValue.split(separator);

	return entries.filter((existing) => !matches(existing)).join(separator);
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

export function hasWindowsMachinePathEntry(entry: string): boolean {
	return hasPathEntryIgnoringCase(readWindowsRegistryPath("machine").value, entry, ";");
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
