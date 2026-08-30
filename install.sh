#!/bin/sh
set -eu

base_url="${ZNPM_BASE_URL:-https://github.com/visionsofparadise/znpm/releases/latest/download}"

case "$(uname -s)/$(uname -m)" in
	Linux/x86_64) target="linux-x64" ;;
	Darwin/arm64) target="darwin-arm64" ;;
	Darwin/x86_64) target="darwin-x64" ;;
	*)
		echo "znpm supports linux x64, macos arm64, and macos x64 only." >&2
		exit 1
		;;
esac

if [ -z "${HOME:-}" ]; then
	echo "znpm requires HOME to be set." >&2
	exit 1
fi

app_directory="$HOME/.local/share/znpm"
bin_directory="$app_directory/bin"
link_path="/usr/local/bin/znpm"
znpm_asset="znpm-$target"
npm_wrapper_asset="npm-wrapper-$target"

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

temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT

fetch "$base_url/SHA256SUMS" >"$temporary_directory/SHA256SUMS"
fetch "$base_url/$znpm_asset" >"$temporary_directory/$znpm_asset"
fetch "$base_url/$npm_wrapper_asset" >"$temporary_directory/$npm_wrapper_asset"

(cd "$temporary_directory" && verify)

mkdir -p "$bin_directory"
mv "$temporary_directory/$npm_wrapper_asset" "$app_directory/npm-wrapper"
chmod +x "$app_directory/npm-wrapper"
mv "$temporary_directory/$znpm_asset" "$bin_directory/znpm"
chmod +x "$bin_directory/znpm"

if [ -L "$link_path" ]; then
	privileged rm -f "$link_path"
elif [ -e "$link_path" ]; then
	echo "znpm found $link_path that it did not create." >&2
	exit 1
fi

privileged mkdir -p /usr/local/bin
privileged ln -s "$bin_directory/znpm" "$link_path"

if [ -f "$app_directory/state.json" ] && grep -q '"enabled"[[:space:]]*:[[:space:]]*true' "$app_directory/state.json"; then
	"$bin_directory/znpm" place-shim
fi

echo "znpm installed. Open a new terminal and run: znpm enable"
