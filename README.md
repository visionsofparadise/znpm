# znpm

`znpm` frees up drive space by deduplicating the files in `node_modules`. It wraps npm, so you keep using npm as normal, and packages and manifests come out exactly as npm would install them. Your projects don't need to change at all.

## Install

Bash (including Git Bash):

```sh
eval "$(curl -fsSL https://github.com/visionsofparadise/znpm/releases/latest/download/install.sh | sh)"
```

PowerShell:

```powershell
irm https://github.com/visionsofparadise/znpm/releases/latest/download/install.ps1 | iex
```

npm, in bash:

```sh
npm i -g @zcross/znpm && eval "$(znpm enable --shell sh)"
```

npm, in PowerShell:

```powershell
npm i -g @zcross/znpm; znpm enable --shell powershell | iex
```

Supports: Windows x64/arm64, Linux x64/arm64 with glibc or musl, macOS arm64/x64

Each line installs znpm and turns it on in the shell you ran it in. znpm wraps npm, so npm has to be on PATH first. On Windows, turning it on asks for elevation once.

Check that npm is going through znpm:

```sh
npm -v
# X.Y.Z (znpm A.B.C)
```

Then use npm as you always have:

```sh
npm install # node_modules files are deduplicated across the drive
npm run ... # commands unrelated to packages are unaffected
```

## Reclaiming disk

```sh
znpm gc
```

Deletes stored packages on the current drive that no project uses anymore.

## Turning it off

```sh
znpm disable
```

You're back on plain npm instantly, nothing to clean up, and every project keeps working as it is. `znpm enable` turns it back on.

```sh
znpm uninstall
```

Removes znpm from the device entirely.

## Escape hatches

To run a single command on plain npm, set `ZNPM_DISABLE=1` in the environment, or pass `--znpm-disable` on the command.

To persistently disable set `"disabled": true` in znpm's `state.json`.

You can ignore packages by listing them in your `package.json`:

```json
{ "znpm": { "ignore": ["left-pad"] } }
```

An ignored package is left exactly as npm installed it: its own copy, writable.

## License

[MIT](LICENSE)
