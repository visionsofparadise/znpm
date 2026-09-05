import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { npmWrapperDirectoryOf, npmWrapperPathOf, writeState } from "./appData";
import { resolveNpm } from "./npm";

const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");

function usePlatform(platform: NodeJS.Platform): void {
	Object.defineProperty(process, "platform", { value: platform, configurable: true, enumerable: true });
}

function restorePlatform(): void {
	if (platformDescriptor !== undefined) {
		Object.defineProperty(process, "platform", platformDescriptor);
	}
}

const executablePathDescriptor = Object.getOwnPropertyDescriptor(process, "execPath");

function useExecutablePath(executablePath: string): void {
	Object.defineProperty(process, "execPath", { value: executablePath, configurable: true, enumerable: true });
}

function restoreExecutablePath(): void {
	if (executablePathDescriptor !== undefined) {
		Object.defineProperty(process, "execPath", executablePathDescriptor);
	}
}

function makeNpmInstallation(directory: string, npmName: string, options: { withNode: boolean }): string {
	mkdirSync(join(directory, "node_modules", "npm", "bin"), { recursive: true });
	writeFileSync(join(directory, "node_modules", "npm", "bin", "npm-cli.js"), "", "utf8");
	writeFileSync(join(directory, npmName), "", "utf8");

	if (options.withNode) {
		writeFileSync(join(directory, "node.exe"), "", "utf8");
	}

	return join(directory, npmName);
}

function pathOf(entries: Array<string>): string {
	return entries.join(delimiter);
}

describe("resolveNpm on Windows", () => {
	let temporaryRoot: string;
	let appDirectory: string;
	let nodejsDirectory: string;
	let bareDirectory: string;

	beforeEach(() => {
		usePlatform("win32");

		temporaryRoot = mkdtempSync(join(tmpdir(), "znpm-npm-"));
		appDirectory = join(temporaryRoot, "app");
		nodejsDirectory = join(temporaryRoot, "nodejs");
		bareDirectory = join(temporaryRoot, "bare");

		mkdirSync(npmWrapperDirectoryOf(appDirectory), { recursive: true });
		writeFileSync(join(npmWrapperDirectoryOf(appDirectory), "npm.cmd"), "", "utf8");
		writeFileSync(npmWrapperPathOf(appDirectory), "", "utf8");
		makeNpmInstallation(nodejsDirectory, "npm.cmd", { withNode: true });
		makeNpmInstallation(bareDirectory, "npm.cmd", { withNode: false });
	});

	afterEach(() => {
		restorePlatform();
		restoreExecutablePath();
		rmSync(temporaryRoot, { recursive: true, force: true });
	});

	it("spawns npm-cli.js under the node.exe beside the resolved npm.cmd", () => {
		const env = { PATH: pathOf([nodejsDirectory]) };

		expect(resolveNpm(env, appDirectory)).toEqual({
			command: join(nodejsDirectory, "node.exe"),
			argsPrefix: [join(nodejsDirectory, "node_modules", "npm", "bin", "npm-cli.js")],
		});
	});

	it("falls back to node from PATH when no node.exe sits beside npm.cmd", () => {
		const env = { PATH: pathOf([bareDirectory]) };

		expect(resolveNpm(env, appDirectory)).toEqual({
			command: "node",
			argsPrefix: [join(bareDirectory, "node_modules", "npm", "bin", "npm-cli.js")],
		});
	});

	it("takes the first npm.cmd in PATH order", () => {
		const env = { PATH: pathOf([bareDirectory, nodejsDirectory]) };

		expect(resolveNpm(env, appDirectory).argsPrefix).toEqual([
			join(bareDirectory, "node_modules", "npm", "bin", "npm-cli.js"),
		]);
	});

	it("skips a candidate npm path sitting in the wrapper directory", () => {
		const env = { PATH: pathOf([npmWrapperDirectoryOf(appDirectory), nodejsDirectory]) };

		expect(resolveNpm(env, appDirectory).command).toBe(join(nodejsDirectory, "node.exe"));
	});

	it("skips a wrapper directory spelled with the other platform's separator", () => {
		const env = { PATH: pathOf([npmWrapperDirectoryOf(appDirectory).replaceAll("\\", "/"), nodejsDirectory]) };

		expect(resolveNpm(env, appDirectory).command).toBe(join(nodejsDirectory, "node.exe"));
	});

	it("resolves an entry spelled with the other platform's separator", () => {
		const env = { PATH: pathOf([nodejsDirectory.replaceAll("\\", "/")]) };

		expect(resolveNpm(env, appDirectory).command).toBe(join(nodejsDirectory, "node.exe"));
	});

	it("skips the npm.cmd forwarder beside the running executable when the app directory sits elsewhere", () => {
		const placedDirectory = join(temporaryRoot, "placed", "npm-wrapper");

		mkdirSync(placedDirectory, { recursive: true });
		writeFileSync(join(placedDirectory, "npm.exe"), "", "utf8");
		writeFileSync(join(placedDirectory, "npm.cmd"), "", "utf8");
		useExecutablePath(join(placedDirectory, "npm.exe"));

		const env = { PATH: pathOf([placedDirectory, nodejsDirectory]) };

		expect(resolveNpm(env, join(temporaryRoot, "elsewhere")).command).toBe(join(nodejsDirectory, "node.exe"));
	});

	it("resolves the npm.cmd sitting beside a running node.exe", () => {
		useExecutablePath(join(nodejsDirectory, "node.exe"));

		const env = { PATH: pathOf([nodejsDirectory]) };

		expect(resolveNpm(env, join(temporaryRoot, "elsewhere"))).toEqual({
			command: join(nodejsDirectory, "node.exe"),
			argsPrefix: [join(nodejsDirectory, "node_modules", "npm", "bin", "npm-cli.js")],
		});
	});

	it("derives node and npm-cli.js from the recorded npm when PATH holds none", () => {
		writeState(appDirectory, {
			enabled: true,
			disabled: false,
			changes: [],
			npmPath: join(nodejsDirectory, "npm.cmd"),
		});

		const env = { PATH: pathOf([join(temporaryRoot, "absent")]) };

		expect(resolveNpm(env, appDirectory)).toEqual({
			command: join(nodejsDirectory, "node.exe"),
			argsPrefix: [join(nodejsDirectory, "node_modules", "npm", "bin", "npm-cli.js")],
		});
	});

	it("throws when PATH holds no npm and the state records none", () => {
		expect(() => resolveNpm({ PATH: "" }, appDirectory)).toThrow();
	});

	it("throws when PATH is unset and the state records none", () => {
		expect(() => resolveNpm({}, appDirectory)).toThrow();
	});
});

describe("resolveNpm on POSIX", () => {
	let temporaryRoot: string;
	let appDirectory: string;
	let npmDirectory: string;

	beforeEach(() => {
		usePlatform("linux");

		temporaryRoot = mkdtempSync(join(tmpdir(), "znpm-npm-"));
		appDirectory = join(temporaryRoot, "app");
		npmDirectory = join(temporaryRoot, "usr-local-bin");

		mkdirSync(npmWrapperDirectoryOf(appDirectory), { recursive: true });
		writeFileSync(npmWrapperPathOf(appDirectory), "", "utf8");
		makeNpmInstallation(npmDirectory, "npm", { withNode: false });
	});

	afterEach(() => {
		restorePlatform();
		restoreExecutablePath();
		rmSync(temporaryRoot, { recursive: true, force: true });
	});

	it("spawns the resolved npm itself with no argument prefix", () => {
		const env = { PATH: pathOf([npmDirectory]) };

		expect(resolveNpm(env, appDirectory)).toEqual({ command: join(npmDirectory, "npm"), argsPrefix: [] });
	});

	it("skips a candidate npm path sitting in the wrapper directory", () => {
		const env = { PATH: pathOf([npmWrapperDirectoryOf(appDirectory), npmDirectory]) };

		expect(resolveNpm(env, appDirectory).command).toBe(join(npmDirectory, "npm"));
	});

	it("skips a candidate npm path whose canonical path is the npm wrapper binary", (context) => {
		const linkedDirectory = join(temporaryRoot, "linked");

		mkdirSync(linkedDirectory, { recursive: true });

		try {
			symlinkSync(npmWrapperPathOf(appDirectory), join(linkedDirectory, "npm"), "file");
		} catch {
			context.skip("this device refuses file symlinks");
		}

		const env = { PATH: pathOf([linkedDirectory, npmDirectory]) };

		expect(resolveNpm(env, appDirectory).command).toBe(join(npmDirectory, "npm"));
	});

	it("skips the running executable when the app directory sits elsewhere", () => {
		const placedDirectory = join(temporaryRoot, "placed", "npm-wrapper");

		mkdirSync(placedDirectory, { recursive: true });
		writeFileSync(join(placedDirectory, "npm"), "", "utf8");
		useExecutablePath(join(placedDirectory, "npm"));

		const env = { PATH: pathOf([placedDirectory, npmDirectory]) };

		expect(resolveNpm(env, join(temporaryRoot, "elsewhere")).command).toBe(join(npmDirectory, "npm"));
	});

	it("skips a candidate npm symlinked to the running executable", (context) => {
		const placedDirectory = join(temporaryRoot, "placed", "npm-wrapper");
		const linkedDirectory = join(temporaryRoot, "linked-self");

		mkdirSync(placedDirectory, { recursive: true });
		mkdirSync(linkedDirectory, { recursive: true });
		writeFileSync(join(placedDirectory, "npm"), "", "utf8");

		try {
			symlinkSync(join(placedDirectory, "npm"), join(linkedDirectory, "npm"), "file");
		} catch {
			context.skip("this device refuses file symlinks");
		}

		useExecutablePath(join(placedDirectory, "npm"));

		const env = { PATH: pathOf([linkedDirectory, npmDirectory]) };

		expect(resolveNpm(env, join(temporaryRoot, "elsewhere")).command).toBe(join(npmDirectory, "npm"));
	});

	it("falls back to the recorded npm when PATH holds none", () => {
		writeState(appDirectory, { enabled: true, disabled: false, changes: [], npmPath: join(npmDirectory, "npm") });

		const env = { PATH: pathOf([join(temporaryRoot, "absent")]) };

		expect(resolveNpm(env, appDirectory)).toEqual({ command: join(npmDirectory, "npm"), argsPrefix: [] });
	});

	it("throws when PATH holds no npm and the state records none", () => {
		expect(() => resolveNpm({ PATH: "" }, appDirectory)).toThrow();
	});
});
