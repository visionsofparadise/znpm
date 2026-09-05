#!/bin/sh
set -eu

step() {
	printf '%s\n' "$1" >&2
}

step "installing..."

base_url="${ZNPM_BASE_URL:-https://github.com/visionsofparadise/znpm/releases/latest/download}"
dist_directory="${ZNPM_DIST:-}"

kernel="$(uname -s)"
machine="$(uname -m)"

case "$kernel" in
	Linux) os="linux" ;;
	Darwin) os="darwin" ;;
	MINGW* | MSYS* | CYGWIN* | Windows_NT) os="windows" ;;
	*)
		step "znpm has no build for $kernel."
		exit 1
		;;
esac

case "$machine" in
	x86_64 | amd64) arch="x64" ;;
	aarch64 | arm64) arch="arm64" ;;
	*)
		step "znpm has no build for $os $machine."
		exit 1
		;;
esac

libc=""

if [ "$os" = "linux" ]; then
	if ldd --version 2>&1 | grep -qi musl; then
		libc="-musl"
	else
		for loader in /lib/ld-musl-*; do
			if [ -f "$loader" ]; then
				libc="-musl"
			fi
			break
		done
	fi
fi

target="$os-$arch$libc"

if [ "$os" = "windows" ]; then
	exe=".exe"
else
	exe=""
fi

posix_path() {
	if command -v cygpath >/dev/null 2>&1; then
		cygpath -u "$1"
	else
		printf '%s\n' "$1"
	fi
}

windows_path() {
	if command -v cygpath >/dev/null 2>&1; then
		cygpath -w "$1"
	else
		printf '%s\n' "$1" | sed -e 's|^/c/|C:/|' -e 's|^/d/|D:/|' -e 's|/|\\|g'
	fi
}

single_quote() {
	printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

if [ -n "${ZNPM_HOME:-}" ]; then
	if [ "$os" = "windows" ]; then
		app_directory="$(posix_path "$ZNPM_HOME")"
	else
		app_directory="$ZNPM_HOME"
	fi
elif [ "$os" = "windows" ]; then
	if [ -n "${LOCALAPPDATA:-}" ]; then
		windows_home="$LOCALAPPDATA"
	elif [ -n "${HOME:-}" ]; then
		windows_home="$HOME/AppData/Local"
	else
		step "znpm requires ZNPM_HOME, LOCALAPPDATA, or HOME."
		exit 1
	fi
	app_directory="$(posix_path "$windows_home")/znpm"
elif [ -n "${XDG_DATA_HOME:-}" ]; then
	app_directory="$XDG_DATA_HOME/znpm"
elif [ -n "${HOME:-}" ]; then
	app_directory="$HOME/.local/share/znpm"
else
	step "znpm requires ZNPM_HOME, XDG_DATA_HOME, or HOME."
	exit 1
fi

bin_directory="$app_directory/bin"
npm_wrapper_directory="$app_directory/npm-wrapper"
znpm_asset="znpm-$target$exe"
npm_wrapper_asset="npm-wrapper-$target$exe"
znpm_path="$bin_directory/znpm$exe"
npm_wrapper_path="$npm_wrapper_directory/npm$exe"

step "installing $target into $app_directory"

fetch() {
	if command -v curl >/dev/null 2>&1; then
		curl -fsSL "$1"
	elif command -v wget >/dev/null 2>&1; then
		wget -qO- "$1"
	else
		step "znpm requires curl or wget."
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
		step "znpm requires sha256sum or shasum."
		exit 1
	fi
}

write_env_files() {
	{
		printf 'znpm_home=%s\n' "$(single_quote "$app_directory")"
		cat <<'ENV_BODY'
case ":$PATH:" in
	*":$znpm_home/npm-wrapper:"*) ;;
	*) export PATH="$znpm_home/npm-wrapper:$znpm_home/bin:$PATH" ;;
esac
unset znpm_home
ENV_BODY
	} >"$app_directory/env"

	{
		printf 'set -l znpm_home %s\n' "$(single_quote "$app_directory")"
		cat <<'FISH_BODY'
if not contains "$znpm_home/npm-wrapper" $PATH
	set -gx PATH "$znpm_home/npm-wrapper" "$znpm_home/bin" $PATH
end
FISH_BODY
	} >"$app_directory/env.fish"
}

add_startup_line() {
	startup_file="$1"

	if [ ! -f "$startup_file" ]; then
		if [ "$2" != "create" ]; then
			return 0
		fi

		: >"$startup_file"
	fi

	if grep -qxF "$startup_line" "$startup_file"; then
		return 0
	fi

	if [ -n "$(tail -c 1 "$startup_file")" ]; then
		printf '\n' >>"$startup_file"
	fi

	printf '%s\n' "$startup_line" >>"$startup_file"
}

expose_posix() {
	write_env_files

	startup_line=". $(single_quote "$app_directory/env")"

	add_startup_line "$HOME/.profile" create
	add_startup_line "$HOME/.bashrc" create
	add_startup_line "$HOME/.zshrc" create
	add_startup_line "$HOME/.bash_profile" skip
	add_startup_line "$HOME/.zprofile" skip

	if [ -d "$HOME/.config/fish" ]; then
		mkdir -p "$HOME/.config/fish/conf.d"
		cp "$app_directory/env.fish" "$HOME/.config/fish/conf.d/znpm.fish"
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

if [ -n "$dist_directory" ]; then
	dist_directory="$(posix_path "$dist_directory")"
	dist_directory="$(cd "$dist_directory" && pwd)"
fi

temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT

mkdir -p "$bin_directory"
mkdir -p "$npm_wrapper_directory"

if [ -n "$dist_directory" ]; then
	step "using local dist $dist_directory"
	if [ ! -f "$dist_directory/$znpm_asset" ]; then
		step "znpm found no $znpm_asset in $dist_directory"
		exit 1
	fi
	if [ ! -f "$dist_directory/$npm_wrapper_asset" ]; then
		step "znpm found no $npm_wrapper_asset in $dist_directory"
		exit 1
	fi
	step "placing $npm_wrapper_path"
	cp "$dist_directory/$npm_wrapper_asset" "$npm_wrapper_path"
	chmod +x "$npm_wrapper_path"
	step "placing $znpm_path"
	cp "$dist_directory/$znpm_asset" "$znpm_path"
	chmod +x "$znpm_path"
else
	step "downloading SHA256SUMS"
	fetch "$base_url/SHA256SUMS" >"$temporary_directory/SHA256SUMS"
	step "downloading $znpm_asset"
	fetch "$base_url/$znpm_asset" >"$temporary_directory/$znpm_asset"
	step "downloading $npm_wrapper_asset"
	fetch "$base_url/$npm_wrapper_asset" >"$temporary_directory/$npm_wrapper_asset"

	step "verifying checksums"
	(cd "$temporary_directory" && verify)

	step "placing $npm_wrapper_path"
	mv "$temporary_directory/$npm_wrapper_asset" "$npm_wrapper_path"
	chmod +x "$npm_wrapper_path"
	step "placing $znpm_path"
	mv "$temporary_directory/$znpm_asset" "$znpm_path"
	chmod +x "$znpm_path"
fi

if [ "$os" = "windows" ]; then
	step "prepending $bin_directory to the user PATH"
	add_windows_user_path "$bin_directory"
else
	step "writing $app_directory/env and the shell startup lines"
	expose_posix
fi

step "installed"

path_prefix="$npm_wrapper_directory:$bin_directory"

export PATH="$path_prefix:$PATH"
hash -r 2>/dev/null || true

printf 'export PATH="%s:$PATH"\n' "$path_prefix"
printf '%s\n' 'hash -r 2>/dev/null || true'

step "run: znpm enable"
