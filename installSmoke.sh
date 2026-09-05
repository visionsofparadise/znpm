#!/bin/sh
set -eu

if [ $# -ne 1 ]; then
	printf '%s\n' "usage: installSmoke.sh <dist directory>" >&2
	exit 1
fi

dist_directory="$(cd "$1" && pwd)"
repository_root="$(cd "$(dirname "$0")" && pwd)"

fail() {
	printf '%s\n' "$1" >&2
	exit 1
}

step() {
	printf '%s\n' "== $1" >&2
}

temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT

step "install"
ZNPM_DIST="$dist_directory" sh "$repository_root/install.sh" >"$temporary_directory/env.sh" || fail "install.sh exited nonzero"

. "$temporary_directory/env.sh"

if [ -n "${ZNPM_HOME:-}" ]; then
	app_directory="$ZNPM_HOME"
elif [ -n "${XDG_DATA_HOME:-}" ]; then
	app_directory="$XDG_DATA_HOME/znpm"
else
	app_directory="$HOME/.local/share/znpm"
fi

znpm_resolved="$(command -v znpm)" || fail "znpm is not on PATH after install"

case "$znpm_resolved" in
	"$app_directory"/*) ;;
	*) fail "znpm resolved to $znpm_resolved outside $app_directory" ;;
esac

step "enable"
znpm enable >&2 || fail "znpm enable exited nonzero"

npm_version="$(npm -v)" || fail "npm -v exited nonzero while enabled"

case "$npm_version" in
	*"(znpm "*) ;;
	*) fail "npm -v printed $npm_version while enabled" ;;
esac

step "install a fixture"
mkdir -p "$temporary_directory/fixture"
printf '%s\n' '{"name":"znpm-smoke","private":true,"dependencies":{"ms":"2.1.3"}}' >"$temporary_directory/fixture/package.json"

(
	cd "$temporary_directory/fixture"
	npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false npm install >&2
) || fail "npm install exited nonzero"

manifest_path="$temporary_directory/fixture/node_modules/ms/package.json"

[ -f "$manifest_path" ] || fail "npm install left no $manifest_path"

if link_count="$(stat -c %h "$manifest_path" 2>/dev/null)"; then
	:
elif link_count="$(stat -f %l "$manifest_path" 2>/dev/null)"; then
	:
else
	fail "stat reported no link count for $manifest_path"
fi

[ "$link_count" -gt 1 ] || fail "expected a store-linked tree, got link count $link_count"

step "disable"
znpm disable >&2 || fail "znpm disable exited nonzero"

npm_version="$(npm -v)" || fail "npm -v exited nonzero while disabled"

case "$npm_version" in
	*"(znpm "*) fail "npm -v printed $npm_version while disabled" ;;
	*) ;;
esac

step "uninstall"
znpm uninstall >&2 || fail "znpm uninstall exited nonzero"

[ ! -d "$app_directory" ] || fail "znpm uninstall left $app_directory"

startup_line=". '$app_directory/env'"

for startup_file in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.bash_profile" "$HOME/.zprofile"; do
	if [ ! -f "$startup_file" ]; then
		continue
	fi

	if grep -F "$startup_line" "$startup_file" >/dev/null 2>&1; then
		fail "znpm uninstall left the startup line in $startup_file"
	fi
done

step "install smoke passed"
