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

normalize_posix_path() {
	normalize_rest="$1"
	normalize_result=""

	case "$normalize_rest" in
		/*) normalize_root="/" ;;
		*) normalize_root="" ;;
	esac

	while [ -n "$normalize_rest" ]; do
		normalize_segment="${normalize_rest%%/*}"

		case "$normalize_rest" in
			*/*) normalize_rest="${normalize_rest#*/}" ;;
			*) normalize_rest="" ;;
		esac

		case "$normalize_segment" in
			"" | ".") ;;
			"..")
				case "$normalize_result" in
					"" | ".." | */..)
						if [ -z "$normalize_root" ]; then
							normalize_result="${normalize_result:+$normalize_result/}.."
						fi
						;;
					*/*) normalize_result="${normalize_result%/*}" ;;
					*) normalize_result="" ;;
				esac
				;;
			*) normalize_result="${normalize_result:+$normalize_result/}$normalize_segment" ;;
		esac
	done

	if [ -n "$normalize_root" ]; then
		printf '%s\n' "/$normalize_result"
	elif [ -n "$normalize_result" ]; then
		printf '%s\n' "$normalize_result"
	else
		printf '%s\n' "."
	fi
}

resolve_posix_path() {
	case "$1" in
		/*) normalize_posix_path "$1" ;;
		*) normalize_posix_path "$(pwd -P)/$1" ;;
	esac
}

home_directory="${HOME:-}"

if [ -n "${ZNPM_HOME:-}" ]; then
	if [ "$os" = "windows" ]; then
		app_directory="$(posix_path "$ZNPM_HOME")"
	else
		app_directory="$(resolve_posix_path "$ZNPM_HOME")"
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
	app_directory="$(normalize_posix_path "$XDG_DATA_HOME/znpm")"
else
	if [ -z "$home_directory" ]; then
		step "znpm requires ZNPM_HOME, XDG_DATA_HOME, or HOME."
		exit 1
	fi

	app_directory="$(normalize_posix_path "$home_directory/.local/share/znpm")"
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
	grep -E "[[:space:]][*]?($znpm_asset|$npm_wrapper_asset)\$" SHA256SUMS >SHA256SUMS.selected || true

	if [ "$(wc -l <SHA256SUMS.selected)" -ne 2 ]; then
		step "znpm found no SHA256SUMS lines for $znpm_asset and $npm_wrapper_asset."
		exit 1
	fi

	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum -c SHA256SUMS.selected >&2
	elif command -v shasum >/dev/null 2>&1; then
		shasum -a 256 -c SHA256SUMS.selected >&2
	else
		step "znpm requires sha256sum or shasum."
		exit 1
	fi
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

step "installed"

"$znpm_path" enable --shell sh
