import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	ensureExposure,
	envFilePathOf,
	fishEnvFilePathOf,
	fishStartupFilePathOf,
	isNpmPackageExecutable,
	posixEnvScriptOf,
	posixFishEnvScriptOf,
	removeExposure,
	startupFilesOf,
	startupSourceLineOf,
	withoutStartupLine,
	withStartupLine,
} from "./exposure";

const appDirectory = "/home/someone/.local/share/znpm";
const quotedAppDirectory = "/home/some'one/znpm";

describe("posixEnvScriptOf", () => {
	it("writes the env script byte for byte", () => {
		expect(posixEnvScriptOf(appDirectory)).toBe(
			[
				`znpm_home='${appDirectory}'`,
				'case ":$PATH:" in',
				'\t*":$znpm_home/npm-wrapper:"*) ;;',
				'\t*) export PATH="$znpm_home/npm-wrapper:$znpm_home/bin:$PATH" ;;',
				"esac",
				"unset znpm_home",
				"",
			].join("\n"),
		);
	});

	it("closes and reopens the quoting around a single quote", () => {
		expect(posixEnvScriptOf(quotedAppDirectory).split("\n")[0]).toBe("znpm_home='/home/some'\\''one/znpm'");
	});
});

describe("posixFishEnvScriptOf", () => {
	it("writes the fish env script byte for byte", () => {
		expect(posixFishEnvScriptOf(appDirectory)).toBe(
			[
				`set -l znpm_home '${appDirectory}'`,
				'if not contains "$znpm_home/npm-wrapper" $PATH',
				'\tset -gx PATH "$znpm_home/npm-wrapper" "$znpm_home/bin" $PATH',
				"end",
				"",
			].join("\n"),
		);
	});

	it("closes and reopens the quoting around a single quote", () => {
		expect(posixFishEnvScriptOf(quotedAppDirectory).split("\n")[0]).toBe(
			"set -l znpm_home '/home/some'\\''one/znpm'",
		);
	});
});

describe("startupSourceLineOf", () => {
	it("sources the env file", () => {
		expect(startupSourceLineOf(appDirectory)).toBe(`. '${envFilePathOf(appDirectory)}'`);
	});

	it("closes and reopens the quoting around a single quote", () => {
		expect(startupSourceLineOf(quotedAppDirectory)).toBe(
			`. '${envFilePathOf(quotedAppDirectory).replace("some'one", "some'\\''one")}'`,
		);
	});
});

describe("startupFilesOf", () => {
	it("names every startup file and which one it creates", () => {
		expect(startupFilesOf("/home/someone")).toEqual([
			{ path: join("/home/someone", ".profile"), createIfAbsent: true },
			{ path: join("/home/someone", ".bashrc"), createIfAbsent: true },
			{ path: join("/home/someone", ".zshrc"), createIfAbsent: true },
			{ path: join("/home/someone", ".bash_profile"), createIfAbsent: false },
			{ path: join("/home/someone", ".zprofile"), createIfAbsent: false },
		]);
	});
});

describe("withStartupLine", () => {
	const line = ". '/home/someone/.local/share/znpm/env'";

	it("writes the line into empty content", () => {
		expect(withStartupLine("", line)).toBe(`${line}\n`);
	});

	it("ends the last line before appending", () => {
		expect(withStartupLine("export EDITOR=vi", line)).toBe(`export EDITOR=vi\n${line}\n`);
	});

	it("leaves content already carrying the line", () => {
		const content = `${line}\n`;

		expect(withStartupLine(content, line)).toBe(content);
	});

	it("leaves content carrying the line among others", () => {
		const content = `export EDITOR=vi\n${line}\nexport PAGER=less\n`;

		expect(withStartupLine(content, line)).toBe(content);
	});
});

describe("withoutStartupLine", () => {
	const line = ". '/home/someone/.local/share/znpm/env'";

	it("removes every occurrence and leaves the other lines", () => {
		expect(withoutStartupLine(`${line}\nexport EDITOR=vi\n${line}\n`, line)).toBe("export EDITOR=vi\n");
	});

	it("leaves content without the line", () => {
		expect(withoutStartupLine("export EDITOR=vi\n", line)).toBe("export EDITOR=vi\n");
	});
});

describe("isNpmPackageExecutable", () => {
	it("finds the platform package on a posix path", () => {
		expect(isNpmPackageExecutable("/usr/lib/node_modules/@zcross/znpm-linux-x64/bin/znpm")).toBe(true);
	});

	it("finds the platform package on a Windows path", () => {
		expect(
			isNpmPackageExecutable(
				"C:\\Users\\someone\\AppData\\Roaming\\npm\\node_modules\\@zcross\\znpm-windows-x64\\bin\\znpm.exe",
			),
		).toBe(true);
	});

	it("refuses an executable under the app directory", () => {
		expect(isNpmPackageExecutable(join(appDirectory, "bin", "znpm"))).toBe(false);
	});
});

describe.skipIf(process.platform === "win32")("the posix exposure", () => {
	let temporaryRoot: string;
	let homeDirectory: string;
	let temporaryAppDirectory: string;

	beforeEach(() => {
		temporaryRoot = mkdtempSync(join(tmpdir(), "znpm-exposure-"));
		homeDirectory = join(temporaryRoot, "home");
		temporaryAppDirectory = join(temporaryRoot, "app");
		mkdirSync(homeDirectory, { recursive: true });
	});

	afterEach(() => {
		rmSync(temporaryRoot, { recursive: true, force: true });
	});

	it("writes the env files, the startup lines, and no fish file without a fish configuration", () => {
		writeFileSync(join(homeDirectory, ".bash_profile"), "export EDITOR=vi\n", "utf8");
		ensureExposure(temporaryAppDirectory, { HOME: homeDirectory });

		const line = startupSourceLineOf(temporaryAppDirectory);

		expect(readFileSync(envFilePathOf(temporaryAppDirectory), "utf8")).toBe(posixEnvScriptOf(temporaryAppDirectory));
		expect(readFileSync(fishEnvFilePathOf(temporaryAppDirectory), "utf8")).toBe(
			posixFishEnvScriptOf(temporaryAppDirectory),
		);
		expect(readFileSync(join(homeDirectory, ".profile"), "utf8")).toBe(`${line}\n`);
		expect(readFileSync(join(homeDirectory, ".bashrc"), "utf8")).toBe(`${line}\n`);
		expect(readFileSync(join(homeDirectory, ".zshrc"), "utf8")).toBe(`${line}\n`);
		expect(readFileSync(join(homeDirectory, ".bash_profile"), "utf8")).toBe(`export EDITOR=vi\n${line}\n`);
		expect(existsSync(join(homeDirectory, ".zprofile"))).toBe(false);
		expect(existsSync(fishStartupFilePathOf(homeDirectory))).toBe(false);
	});

	it("writes the fish startup file when a fish configuration exists", () => {
		mkdirSync(join(homeDirectory, ".config", "fish"), { recursive: true });
		ensureExposure(temporaryAppDirectory, { HOME: homeDirectory });

		expect(readFileSync(fishStartupFilePathOf(homeDirectory), "utf8")).toBe(
			posixFishEnvScriptOf(temporaryAppDirectory),
		);
	});

	it("leaves the startup files unchanged on a second ensure", () => {
		ensureExposure(temporaryAppDirectory, { HOME: homeDirectory });

		const first = readFileSync(join(homeDirectory, ".profile"), "utf8");

		ensureExposure(temporaryAppDirectory, { HOME: homeDirectory });

		expect(readFileSync(join(homeDirectory, ".profile"), "utf8")).toBe(first);
	});

	it("removes every line and the fish startup file", () => {
		mkdirSync(join(homeDirectory, ".config", "fish"), { recursive: true });
		writeFileSync(join(homeDirectory, ".bash_profile"), "export EDITOR=vi\n", "utf8");
		ensureExposure(temporaryAppDirectory, { HOME: homeDirectory });
		removeExposure(temporaryAppDirectory, { HOME: homeDirectory });

		expect(readFileSync(join(homeDirectory, ".profile"), "utf8")).toBe("");
		expect(readFileSync(join(homeDirectory, ".bashrc"), "utf8")).toBe("");
		expect(readFileSync(join(homeDirectory, ".zshrc"), "utf8")).toBe("");
		expect(readFileSync(join(homeDirectory, ".bash_profile"), "utf8")).toBe("export EDITOR=vi\n");
		expect(existsSync(fishStartupFilePathOf(homeDirectory))).toBe(false);
	});
});
