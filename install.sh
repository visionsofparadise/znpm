#!/bin/sh
set -eu

echo "installing..."

base_url="${ZNPM_BASE_URL:-https://github.com/visionsofparadise/znpm/releases/latest/download}"

kernel="$(uname -s)"
machine="$(uname -m)"

case "$kernel" in
	Linux) os="linux" ;;
	Darwin) os="darwin" ;;
	MINGW* | MSYS* | CYGWIN* | Windows_NT) os="windows" ;;
	*)
		echo "znpm has no build for $kernel." >&2
		exit 1
		;;
esac

case "$machine" in
	x86_64 | amd64) arch="x64" ;;
	aarch64 | arm64) arch="arm64" ;;
	*)
		echo "znpm has no build for $os $machine." >&2
		exit 1
		;;
esac

target="$os-$arch"

if [ "$os" = "windows" ]; then
	exe=".exe"
	if [ -n "${LOCALAPPDATA:-}" ]; then
		windows_home="$LOCALAPPDATA"
	elif [ -n "${HOME:-}" ]; then
		windows_home="$HOME/AppData/Local"
	else
		echo "znpm requires LOCALAPPDATA or HOME." >&2
		exit 1
	fi
	if command -v cygpath >/dev/null 2>&1; then
		app_directory="$(cygpath -u "$windows_home")/znpm"
	else
		app_directory="$windows_home/znpm"
	fi
else
	exe=""
	if [ -z "${HOME:-}" ]; then
		echo "znpm requires HOME." >&2
		exit 1
	fi
	app_directory="$HOME/.local/share/znpm"
fi

bin_directory="$app_directory/bin"
shim_directory="$app_directory/shim"
znpm_asset="znpm-$target$exe"
npm_wrapper_asset="npm-wrapper-$target$exe"
znpm_path="$bin_directory/znpm$exe"
npm_wrapper_path="$app_directory/npm-wrapper$exe"

windows_path() {
	if command -v cygpath >/dev/null 2>&1; then
		cygpath -w "$1"
	else
		printf '%s\n' "$1" | sed -e 's|^/c/|C:/|' -e 's|^/d/|D:/|' -e 's|/|\\|g'
	fi
}

fetch() {
	if command -v curl >/dev/null 2>&1; then
		curl -fsSL "$1"
	elif command -v wget >/dev/null 2>&1; then
		wget -qO- "$1"
	else
		echo "znpm requires curl or wget." >&2
		exit 1
	fi
}

verify() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum -c --status --ignore-missing SHA256SUMS
	elif command -v shasum >/dev/null 2>&1; then
		grep -E "[[:space:]][*]?($znpm_asset|$npm_wrapper_asset)\$" SHA256SUMS >SHA256SUMS.selected
		shasum -a 256 -c --status SHA256SUMS.selected
	else
		echo "znpm requires sha256sum or shasum." >&2
		exit 1
	fi
}

privileged() {
	if [ -w /usr/local/bin ]; then
		"$@"
	else
		sudo "$@"
	fi
}

add_windows_user_path() {
	entry="$(windows_path "$1")"
	ps1="$temporary_directory/add-user-path.ps1"
	cat >"$ps1" <<'EOF'
$ErrorActionPreference = "Stop"
$entry = $env:ZNPM_PATH_ENTRY
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment", $true)
if ($null -eq $key) { throw "znpm could not open the user PATH key" }
try {
	$kind = 2
	$value = ""
	if ($key.GetValueNames() | Where-Object { $_ -ieq "Path" }) {
		$kind = [int]$key.GetValueKind("Path")
		$raw = $key.GetValue("Path", "", [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
		if ($raw -is [string[]]) { $value = ($raw -join ";") }
		elseif ($null -ne $raw) { $value = [string]$raw }
	}
	$entries = @()
	if ($value -ne "") { $entries = $value -split ";" }
	if ($entries | Where-Object { $_ -ieq $entry }) { return }
	$key.SetValue("Path", ((@($entry) + $entries) -join ";"), [Microsoft.Win32.RegistryValueKind]$kind)
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
EOF
	ZNPM_PATH_ENTRY="$entry" powershell.exe -NoProfile -NonInteractive -File "$(windows_path "$ps1")"
}

temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT

fetch "$base_url/SHA256SUMS" >"$temporary_directory/SHA256SUMS"
fetch "$base_url/$znpm_asset" >"$temporary_directory/$znpm_asset"
fetch "$base_url/$npm_wrapper_asset" >"$temporary_directory/$npm_wrapper_asset"

(cd "$temporary_directory" && verify)

mkdir -p "$bin_directory"
mv "$temporary_directory/$npm_wrapper_asset" "$npm_wrapper_path"
chmod +x "$npm_wrapper_path"
mv "$temporary_directory/$znpm_asset" "$znpm_path"
chmod +x "$znpm_path"

if [ "$os" = "windows" ]; then
	add_windows_user_path "$bin_directory"
else
	link_path="/usr/local/bin/znpm"
	if [ -L "$link_path" ]; then
		privileged rm -f "$link_path"
	elif [ -e "$link_path" ]; then
		echo "znpm found $link_path that it did not create." >&2
		exit 1
	fi
	privileged mkdir -p /usr/local/bin
	privileged ln -s "$znpm_path" "$link_path"
fi

echo "installed"

"$znpm_path" enable

if [ "$os" = "windows" ]; then
	if command -v cygpath >/dev/null 2>&1; then
		export PATH="$(cygpath -u "$shim_directory"):$(cygpath -u "$bin_directory"):$PATH"
	else
		export PATH="$shim_directory:$bin_directory:$PATH"
	fi
else
	export PATH="/usr/local/bin:$PATH"
fi


