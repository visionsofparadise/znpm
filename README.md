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

npm:

```sh
npm i -g @zcross/znpm
```

The two script lines also put znpm's directories on the PATH of the shell you ran them in, so the check below works in that shell. After `npm i -g` it takes a new shell, and a new session on Windows, because `znpm enable` writes PATH entries that a shell reads when it starts.

Every install leaves znpm off. Turn it on:

```sh
znpm enable
```

On Windows the first `znpm enable` asks for elevation once, because the wrapper has to sit on the machine PATH to get in front of an npm installed by the Node.js installer, which sits there too. `znpm uninstall` asks once more to take that entry back out. Nothing else znpm does needs administrator rights.

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

## Docker

```dockerfile
FROM node:24-alpine
RUN wget -qO- https://github.com/visionsofparadise/znpm/releases/latest/download/install.sh | sh
ENV PATH="/root/.local/share/znpm/npm-wrapper:/root/.local/share/znpm/bin:$PATH"
RUN znpm enable
```

The install writes that same PATH into the shell startup files, and a `RUN` step loads none of them, so the `ENV` line is what puts the wrapper in front of npm for the rest of the build. An image that switches to `USER node` runs the install after the `USER` line, so it lands in `/home/node/.local/share/znpm`, which the `ENV` line then names. An install that runs as root before the switch lands in `/root`, out of the `node` user's reach, and the `RUN znpm enable` after it fails with `znpm: not found`.

`install.sh` downloads with curl or wget and stops when it finds neither. `node:24-alpine` carries BusyBox `wget` and `node:24-bookworm` carries both; `node:24-bookworm-slim` carries neither, so install with `RUN npm i -g @zcross/znpm` there and keep the same `ENV` line.

## Where it lives

znpm works out of one directory: `ZNPM_HOME` when it is set, else `%LOCALAPPDATA%\znpm` on Windows, else `$XDG_DATA_HOME/znpm` when it is set, else `~/.local/share/znpm`. An install from a script line puts everything there: the `znpm` binary, the npm wrapper, the `env` file that posix shells source, and `state.json`. An install from npm keeps the binaries in the global npm prefix instead, under `node_modules/@zcross/znpm-<platform>-<arch>`, and uses the directory for the npm wrapper, the `env` file, and `state.json`.

The deduplicated package files live in a content-addressable store outside it, one per volume, which `ZNPM_STORE_DIR` relocates.

## Reclaiming disk

```sh
znpm gc
```

Deletes stored packages that no project uses anymore, from the store for the working directory's volume. Run it again from a directory on each other volume that has a store.

## Turning it off

```sh
znpm disable
```

You're back on plain npm instantly, nothing to clean up, and every project keeps working as it is. `znpm enable` turns it back on.

```sh
znpm uninstall
```

Removes znpm from the device entirely, along with the global npm package when you installed it with `npm i -g`. Your projects keep working here too. It fails and names the file it could not remove rather than reporting success over a directory that is still there.

On Windows it cannot delete the binary it is running from, so it moves that binary to `%TEMP%\znpm-uninstalled-<pid>.exe` and leaves it there for you to delete whenever you like, around 86 MB. With `%TEMP%` on a different volume from the volume znpm's binary is on, that move fails; point `TEMP` at the same volume and run `znpm uninstall` again.

A version manager installed after znpm appends its own PATH line below znpm's in the shell startup files, so its npm wins in new shells and `npm -v` prints a plain version. Put the wrapper back in front by replacing znpm's `. '<app directory>/env'` line with `export PATH="<app directory>/npm-wrapper:<app directory>/bin:$PATH"` sitting below the version manager's line, in every startup file that carries one. znpm writes its line into as many as five files, and one file is never enough: the `env` file prepends only when the wrapper is absent from PATH, so a second `. '<app directory>/env'` does nothing once an earlier file has run it. That is also why moving the line rather than replacing it leaves the version manager in front on Debian, where `.profile` sources `.bashrc` and then runs the version manager's own second line.

## Escape hatches

To run a single command on plain npm, set `ZNPM_DISABLE=1` in the environment or pass `--znpm-disable` on the command.

Setting `"disabled": true` in znpm's `state.json`, under the directory in [Where it lives](#where-it-lives), does the same for every command until it is set back, and `znpm enable` and `znpm disable` leave that key alone.

You can ignore packages by listing them in your `package.json`:

```json
{ "znpm": { "ignore": ["left-pad"] } }
```

An ignored package is left exactly as npm installed it: its own copy, writable.

## Platforms

Windows x64/arm64, Linux x64/arm64 with glibc or musl, macOS arm64/x64. The musl builds are what run on Alpine.

## License

[MIT](LICENSE)
