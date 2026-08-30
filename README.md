# znpm

`node_modules` hard-linked from a shared per-volume store — every project on the device deduplicated while repos stay byte-identical npm-native.

## Why

Every project on a device keeps its own copy of the packages it installs, so the same bytes sit on disk once per repository. znpm replaces those copies with hard links into one content-addressable store per volume, and a package a second project installs costs that project no disk space at all. Measured on a real repository, 99.4% of the installed tree materialized as hard links into the store.

## Install

Windows:

```powershell
powershell -ExecutionPolicy Bypass -Command "irm https://github.com/visionsofparadise/znpm/releases/latest/download/install.ps1 | iex"
```

macOS and Linux:

```sh
curl -fsSL https://github.com/visionsofparadise/znpm/releases/latest/download/install.sh | sh
```

Installing leaves znpm disabled. Open a new terminal and turn it on:

```sh
znpm enable
```

## How it works

Enabling znpm puts a wrapper in front of npm on the device. Every npm command runs real npm with the original arguments verbatim, and the tree npm produces stands as npm made it. The wrapper then hard-links each finished package into the store, taking its identity from what npm recorded. `package.json` and `package-lock.json` come out byte-identical to what real npm would have written, and nothing is written into the repository.

## Commands

| Command          | Meaning                                                                    |
| ---------------- | -------------------------------------------------------------------------- |
| `znpm enable`    | Resolves every npm entry point on the device to the wrapper.               |
| `znpm disable`   | Returns every npm entry point to real npm.                                 |
| `znpm gc`        | Prunes packages referenced by zero projects from the store of this volume. |
| `znpm uninstall` | Disables znpm and removes it and the wrapper from the device.              |

`enable` and `disable` persist until the other one runs.

## Escape hatches

An npm command under `ZNPM_DISABLE=1` runs real npm directly. An npm command carrying `--znpm-disable` runs real npm with the flag stripped. Both take effect ahead of everything else the wrapper does.

## Guarantees

- After any npm command, `package.json` and `package-lock.json` are byte-identical to what real npm would have produced.
- A repository remains consumable by CI, contributors, and remote environments with npm alone.
- The wrapper writes no artifact into a repository.
- Enabling znpm requires zero changes to any project.
- Disabling znpm returns the device to npm with zero cleanup or migration steps.

## Platforms

- Windows x64
- Linux x64
- macOS arm64
- macOS x64

## License

MIT
