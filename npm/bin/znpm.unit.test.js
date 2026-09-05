import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const shimSource = fileURLToPath(new URL("./znpm.js", import.meta.url));
const resolverSource = fileURLToPath(new URL("../lib/platformPackageOf.js", import.meta.url));

const musl = process.platform === "linux" && process.report.getReport().header.glibcVersionRuntime === undefined;
const platformPackageName = `@zcross/znpm-${process.platform}-${process.arch}${musl ? "-musl" : ""}`;
const binaryName = process.platform === "win32" ? "znpm.exe" : "znpm";

const roots = [];

function writeShimTree() {
	const root = mkdtempSync(join(tmpdir(), "znpm-shim-"));

	roots.push(root);
	mkdirSync(join(root, "bin"), { recursive: true });
	mkdirSync(join(root, "lib"), { recursive: true });
	copyFileSync(shimSource, join(root, "bin", "znpm.js"));
	copyFileSync(resolverSource, join(root, "lib", "platformPackageOf.js"));

	return root;
}

function writePlatformPackage(root, mode) {
	const packageDirectory = join(root, "node_modules", "@zcross", platformPackageName.slice("@zcross/".length));
	const binaryPath = join(packageDirectory, binaryName);

	mkdirSync(packageDirectory, { recursive: true });
	writeFileSync(
		join(packageDirectory, "package.json"),
		`${JSON.stringify({ name: platformPackageName, version: "0.0.0" }, undefined, "\t")}\n`,
		"utf8",
	);
	copyFileSync(process.execPath, binaryPath);
	chmodSync(binaryPath, mode);

	return binaryPath;
}

function runShim(root, shimArguments, nodeArguments = []) {
	return spawnSync(process.execPath, [...nodeArguments, join(root, "bin", "znpm.js"), ...shimArguments], {
		encoding: "utf8",
	});
}

describe("the znpm shim", () => {
	let resolvingRoot;
	let emptyRoot;

	beforeAll(() => {
		resolvingRoot = writeShimTree();
		emptyRoot = writeShimTree();
		writePlatformPackage(resolvingRoot, 0o755);
	});

	afterAll(() => {
		for (const root of roots.splice(0)) {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("spawns the resolved platform binary with the arguments it was given", () => {
		const result = runShim(resolvingRoot, ["-e", "process.stdout.write('spawned')"]);

		expect(result.stderr).toBe("");
		expect(result.stdout).toBe("spawned");
		expect(result.status).toBe(0);
	});

	it("exits with the status the platform binary exited with", () => {
		const result = runShim(resolvingRoot, ["-e", "process.exit(3)"]);

		expect(result.status).toBe(3);
	});

	it("names the package to install when the platform package is absent", () => {
		const result = runShim(emptyRoot, []);

		expect(result.stderr.trim()).toBe(`znpm has no binary for this platform: install ${platformPackageName}`);
		expect(result.status).toBe(1);
	});

	it("prints one line for a platform with no build", () => {
		const preloadPath = join(emptyRoot, "freebsd.mjs");

		writeFileSync(
			preloadPath,
			'Object.defineProperty(process, "platform", { value: "freebsd" });\nObject.defineProperty(process, "arch", { value: "x64" });\n',
			"utf8",
		);

		const result = runShim(emptyRoot, [], ["--import", pathToFileURL(preloadPath).href]);

		expect(result.stderr.trim()).toBe("znpm has no build for freebsd-x64");
		expect(result.status).toBe(1);
	});

	it.skipIf(process.platform === "win32")("prints the spawn error when the platform binary is not executable", () => {
		const root = writeShimTree();

		writePlatformPackage(root, 0o644);

		const result = runShim(root, []);

		expect(result.stderr).toContain("EACCES");
		expect(result.status).toBe(1);
	});
});
