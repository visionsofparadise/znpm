import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { shadowPathOf, shimDirectoryOf, writeState } from "./home";
import { resolveRealNpm } from "./realNpm";

const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");

function usePlatform(platform: NodeJS.Platform): void {
	Object.defineProperty(process, "platform", { value: platform, configurable: true, enumerable: true });
}

function restorePlatform(): void {
	if (platformDescriptor !== undefined) {
		Object.defineProperty(process, "platform", platformDescriptor);
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

describe("resolveRealNpm on Windows", () => {
	let temporaryRoot: string;
	let homeDirectory: string;
	let nodejsDirectory: string;
	let bareDirectory: string;

	beforeEach(() => {
		usePlatform("win32");

		temporaryRoot = mkdtempSync(join(tmpdir(), "znpm-real-npm-"));
		homeDirectory = join(temporaryRoot, "home");
		nodejsDirectory = join(temporaryRoot, "nodejs");
		bareDirectory = join(temporaryRoot, "bare");

		mkdirSync(shimDirectoryOf(homeDirectory), { recursive: true });
		writeFileSync(join(shimDirectoryOf(homeDirectory), "npm.cmd"), "", "utf8");
		writeFileSync(shadowPathOf(homeDirectory), "", "utf8");
		makeNpmInstallation(nodejsDirectory, "npm.cmd", { withNode: true });
		makeNpmInstallation(bareDirectory, "npm.cmd", { withNode: false });
	});

	afterEach(() => {
		restorePlatform();
		rmSync(temporaryRoot, { recursive: true, force: true });
	});

	it("spawns npm-cli.js under the node.exe beside the resolved npm.cmd", () => {
		const env = { PATH: pathOf([nodejsDirectory]) };

		expect(resolveRealNpm(env, homeDirectory)).toEqual({
			command: join(nodejsDirectory, "node.exe"),
			argsPrefix: [join(nodejsDirectory, "node_modules", "npm", "bin", "npm-cli.js")],
		});
	});

	it("falls back to node from PATH when no node.exe sits beside npm.cmd", () => {
		const env = { PATH: pathOf([bareDirectory]) };

		expect(resolveRealNpm(env, homeDirectory)).toEqual({
			command: "node",
			argsPrefix: [join(bareDirectory, "node_modules", "npm", "bin", "npm-cli.js")],
		});
	});

	it("takes the first npm.cmd in PATH order", () => {
		const env = { PATH: pathOf([bareDirectory, nodejsDirectory]) };

		expect(resolveRealNpm(env, homeDirectory).argsPrefix).toEqual([
			join(bareDirectory, "node_modules", "npm", "bin", "npm-cli.js"),
		]);
	});

	it("skips a candidate sitting in the shim directory", () => {
		const env = { PATH: pathOf([shimDirectoryOf(homeDirectory), nodejsDirectory]) };

		expect(resolveRealNpm(env, homeDirectory).command).toBe(join(nodejsDirectory, "node.exe"));
	});

	it("skips a shim directory spelled with the other platform's separator", () => {
		const env = { PATH: pathOf([shimDirectoryOf(homeDirectory).replaceAll("\\", "/"), nodejsDirectory]) };

		expect(resolveRealNpm(env, homeDirectory).command).toBe(join(nodejsDirectory, "node.exe"));
	});

	it("resolves an entry spelled with the other platform's separator", () => {
		const env = { PATH: pathOf([nodejsDirectory.replaceAll("\\", "/")]) };

		expect(resolveRealNpm(env, homeDirectory).command).toBe(join(nodejsDirectory, "node.exe"));
	});

	it("derives node and npm-cli.js from the recorded real npm when PATH holds none", () => {
		writeState(homeDirectory, {
			enabled: true,
			changes: [],
			realNpmPath: join(nodejsDirectory, "npm.cmd"),
		});

		const env = { PATH: pathOf([join(temporaryRoot, "absent")]) };

		expect(resolveRealNpm(env, homeDirectory)).toEqual({
			command: join(nodejsDirectory, "node.exe"),
			argsPrefix: [join(nodejsDirectory, "node_modules", "npm", "bin", "npm-cli.js")],
		});
	});

	it("throws when PATH holds no npm and the state records none", () => {
		expect(() => resolveRealNpm({ PATH: "" }, homeDirectory)).toThrow();
	});

	it("throws when PATH is unset and the state records none", () => {
		expect(() => resolveRealNpm({}, homeDirectory)).toThrow();
	});
});

describe("resolveRealNpm on POSIX", () => {
	let temporaryRoot: string;
	let homeDirectory: string;
	let npmDirectory: string;

	beforeEach(() => {
		usePlatform("linux");

		temporaryRoot = mkdtempSync(join(tmpdir(), "znpm-real-npm-"));
		homeDirectory = join(temporaryRoot, "home");
		npmDirectory = join(temporaryRoot, "usr-local-bin");

		mkdirSync(shimDirectoryOf(homeDirectory), { recursive: true });
		writeFileSync(join(shimDirectoryOf(homeDirectory), "npm"), "", "utf8");
		writeFileSync(shadowPathOf(homeDirectory), "", "utf8");
		makeNpmInstallation(npmDirectory, "npm", { withNode: false });
	});

	afterEach(() => {
		restorePlatform();
		rmSync(temporaryRoot, { recursive: true, force: true });
	});

	it("spawns the resolved npm itself with no argument prefix", () => {
		const env = { PATH: pathOf([npmDirectory]) };

		expect(resolveRealNpm(env, homeDirectory)).toEqual({ command: join(npmDirectory, "npm"), argsPrefix: [] });
	});

	it("skips a candidate sitting in the shim directory", () => {
		const env = { PATH: pathOf([shimDirectoryOf(homeDirectory), npmDirectory]) };

		expect(resolveRealNpm(env, homeDirectory).command).toBe(join(npmDirectory, "npm"));
	});

	it("skips a candidate whose canonical path is the shadow binary", () => {
		const linkedDirectory = join(temporaryRoot, "linked");

		symlinkSync(homeDirectory, linkedDirectory, "junction");

		const env = { PATH: pathOf([linkedDirectory, npmDirectory]) };

		expect(resolveRealNpm(env, homeDirectory).command).toBe(join(npmDirectory, "npm"));
	});

	it("falls back to the recorded real npm when PATH holds none", () => {
		writeState(homeDirectory, { enabled: true, changes: [], realNpmPath: join(npmDirectory, "npm") });

		const env = { PATH: pathOf([join(temporaryRoot, "absent")]) };

		expect(resolveRealNpm(env, homeDirectory)).toEqual({ command: join(npmDirectory, "npm"), argsPrefix: [] });
	});

	it("throws when PATH holds no npm and the state records none", () => {
		expect(() => resolveRealNpm({ PATH: "" }, homeDirectory)).toThrow();
	});
});
