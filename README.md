# znpm

`znpm` frees up drive space by deduplicating the files in `node_modules`. It wraps npm, so you keep using npm as normal, and packages and manifests come out exactly as npm would install them. Your projects don't need to change at all.

## Install

Bash (including Git Bash):

```sh
curl -fsSL https://github.com/visionsofparadise/znpm/releases/latest/download/install.sh | sh
```

PowerShell:

```powershell
irm https://github.com/visionsofparadise/znpm/releases/latest/download/install.ps1 | iex
```

## Reclaiming disk

```sh
znpm gc
```

Deletes stored packages that no project uses anymore.

## Turning it off

```sh
znpm disable
```

You're back on plain npm instantly, nothing to clean up, and every project keeps working as it is. `znpm enable` turns it back on.

```sh
znpm uninstall
```

Removes znpm from the device entirely. Your projects keep working here too.

## Escape hatches

To run a single command on plain npm, set `ZNPM_DISABLE=1` in the environment or pass `--znpm-disable` on the command.

You can ignore packages by listing them in your `package.json`:

```json
{ "znpm": { "ignore": ["left-pad"] } }
```

An ignored package is left exactly as npm installed it: its own copy, writable.

## Platforms

Windows x64/arm64, Linux x64/arm64, macOS arm64/x64.

## License

[MIT](LICENSE)
