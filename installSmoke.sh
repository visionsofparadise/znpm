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

smoke_root="$(mktemp -d)"
app_directory="$smoke_root/znpm"

cleanup() {
	cleanup_status=$?

	trap - EXIT

	if [ -x "$app_directory/bin/znpm" ]; then
		"$app_directory/bin/znpm" uninstall >/dev/null 2>&1 || true
	fi

	rm -rf "$smoke_root"

	exit "$cleanup_status"
}

trap cleanup EXIT

ZNPM_HOME="$smoke_root/./znpm/"
ZNPM_STORE_DIR="$smoke_root/store"
PNPM_HOME="$smoke_root/pnpm-home"

export ZNPM_HOME ZNPM_STORE_DIR PNPM_HOME

step "install"
ZNPM_DIST="$dist_directory" sh "$repository_root/install.sh" >"$smoke_root/env.sh" || fail "install.sh exited nonzero"

. "$smoke_root/env.sh"

step "assert the installer wrote the exposure and left znpm disabled"

env_file="$app_directory/env"
startup_line=". '$app_directory/env'"

[ -f "$env_file" ] || fail "install.sh left no $env_file"
[ -f "$app_directory/env.fish" ] || fail "install.sh left no $app_directory/env.fish"

grep -qxF "znpm_home='$app_directory'" "$env_file" || fail "$env_file carries no znpm_home='$app_directory'"
grep -qF 'export PATH="$znpm_home/npm-wrapper:$znpm_home/bin:$PATH"' "$env_file" || fail "$env_file carries no npm-wrapper PATH export"

exposed_startup_files=0

for startup_file in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.bash_profile" "$HOME/.zprofile"; do
	if [ -f "$startup_file" ] && grep -qxF "$startup_line" "$startup_file"; then
		exposed_startup_files=$((exposed_startup_files + 1))
	fi
done

[ "$exposed_startup_files" -gt 0 ] || fail "install.sh appended $startup_line to no startup file"

npm_version="$(npm -v)" || fail "npm -v exited nonzero after install"

case "$npm_version" in
	*"(znpm "*) fail "npm -v printed $npm_version after install, so install left znpm enabled" ;;
	*) ;;
esac

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
mkdir -p "$smoke_root/fixture"
printf '%s\n' '{"name":"znpm-smoke","private":true,"dependencies":{"ms":"2.1.3"}}' >"$smoke_root/fixture/package.json"

(
	cd "$smoke_root/fixture"
	npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false npm install >&2
) || fail "npm install exited nonzero"

manifest_path="$smoke_root/fixture/node_modules/ms/package.json"

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

for startup_file in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.bash_profile" "$HOME/.zprofile"; do
	if [ ! -f "$startup_file" ]; then
		continue
	fi

	if grep -F "$startup_line" "$startup_file" >/dev/null 2>&1; then
		fail "znpm uninstall left the startup line in $startup_file"
	fi
done

step "install smoke passed"
