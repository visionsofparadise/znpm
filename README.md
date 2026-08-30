# znpm

`node_modules` hard-linked from a shared per-volume store — every project on the device deduplicated while repos stay byte-identical npm-native.

## Why

Every project on a device keeps its own copy of the packages it installs, so the same bytes sit on disk once per repository. znpm replaces those copies with hard links into one content-addressable store per volume, and most of what a second project installs then costs it no new disk space. Measured on one real repository, 99.4% of the installed tree was store-linked before the rule that leaves self-building packages as npm made them; that rule holds about 7% of files back as npm's own copies, and the store carries the rest.

## Install

PowerShell:

```powershell
irm https://github.com/visionsofparadise/znpm/releases/latest/download/install.ps1 | iex
```

Bash (including Git Bash):

```sh
curl -fsSL https://github.com/visionsofparadise/znpm/releases/latest/download/install.sh | sh
```

Install downloads the binaries for this machine, puts znpm on PATH, and runs `znpm enable`. That prompts UAC on Windows and may prompt for `sudo` on macOS and Linux. The shell that ran the one-liner gets the wrapper on PATH; other already-open terminals keep the PATH they started with. Any npm command that mutates the tree then prints a `znpm {...}` summary line to stderr, which is the wrapper reporting what it converted.

`enable`, `disable`, and `uninstall` change how the whole device resolves npm, so each one asks for the same elevation.

## How it works

Enabling znpm puts a wrapper in front of npm on the device. Every npm command runs real npm with the original arguments verbatim, and the tree npm produces stands as npm made it. The wrapper then hard-links each package it can share into the store, taking its identity from what npm recorded — npm extracts its own copy first and the conversion replaces it, so the saving is in what stays on disk rather than in what is downloaded. `package.json` and `package-lock.json` come out byte-identical to what real npm would have written, and the wrapper writes no artifact into a repository: the contents of `node_modules` are the only thing it changes. Converted files are sealed read-only, so editing a package under `node_modules` in place — patch-package's way of working — fails loudly rather than reaching the store and every other project sharing those bytes.

## Commands

| Command          | Meaning                                                                    |
| ---------------- | -------------------------------------------------------------------------- |
| `znpm enable`    | Resolves every npm entry point on the device to the wrapper.               |
| `znpm disable`   | Returns every npm entry point to real npm.                                 |
| `znpm gc`        | Prunes packages referenced by zero projects from the store of this volume. |
| `znpm uninstall` | Disables znpm and removes it and the wrapper from the device.              |

Install turns znpm on. `enable` and `disable` persist until the other one runs.

`disable` and `uninstall` leave every converted tree as it stands: those files keep their hard links and their read-only modes, and npm goes on working over them. The store stays as well — it is pnpm's own store, shared with any pnpm project on the volume — and `znpm gc` prunes the packages no project references any more.

## Escape hatches

An npm command under `ZNPM_DISABLE=1` runs real npm directly. An npm command carrying `--znpm-disable` runs real npm with the flag stripped. Both take effect ahead of everything else the wrapper does.

A project names the packages it wants left alone in its own `package.json`:

```json
{ "znpm": { "ignore": ["cross-spawn"] } }
```

A named package stays exactly as real npm produced it: its own copy, writable.

## Guarantees

- After any npm command, `package.json` and `package-lock.json` are byte-identical to what real npm would have produced.
- A repository remains consumable by CI, contributors, and remote environments with npm alone.
- The wrapper writes no artifact into a repository.
- Enabling znpm requires zero changes to any project.
- Disabling znpm returns the device to npm with zero cleanup or migration steps.

## Platforms

- Windows x64 and arm64
- Linux x64 and arm64
- macOS arm64 and x64

znpm is at v0.1.x. CI smokes Windows x64, Linux x64, Linux arm64, and macOS arm64. Windows arm64 and macOS x64 are cross-compiled.

## License

MIT
