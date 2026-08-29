import { chmodSync, copyFileSync, linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hardlinkVerificationOf } from "./hardlinkVerificationOf";

describe("hardlinkVerificationOf", () => {
	const roots: Array<string> = [];

	afterEach(() => {
		for (const root of roots.splice(0)) {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("returns undefined when the hidden lockfile is absent", () => {
		expect(hardlinkVerificationOf(join("Z:", "no-such-znpm-project"))).toBeUndefined();
	});

	it("reports a placed unshared tarball as notLinked", () => {
		const project = openProject();
		writeHiddenLockfile(project, { ms: "2.1.3" });
		writePackage(project, "ms", "2.1.3");

		const verification = hardlinkVerificationOf(project);

		expect(verification?.expectedLinked).toBe(1);
		expect(verification?.mismatches).toEqual([{ location: "node_modules/ms", name: "ms", kind: "notLinked" }]);
	});

	it("reports a hard-linked unsealed file", () => {
		const project = openProject();
		writeHiddenLockfile(project, { ms: "2.1.3" });
		const store = join(project, "store-ms.json");

		writeFileSync(store, `${JSON.stringify({ name: "ms", version: "2.1.3" })}\n`);
		mkdirSync(join(project, "node_modules", "ms"), { recursive: true });
		linkSync(store, join(project, "node_modules", "ms", "package.json"));

		const verification = hardlinkVerificationOf(project);

		expect(verification?.expectedLinked).toBe(1);
		expect(verification?.mismatches).toEqual([
			{
				location: "node_modules/ms",
				name: "ms",
				kind: "fileNotSealed",
				path: join(project, "node_modules", "ms", "package.json"),
			},
		]);
	});

	it("accepts a sealed hard-linked package", () => {
		const project = openProject();
		writeHiddenLockfile(project, { ms: "2.1.3" });
		const store = join(project, "store-ms.json");
		const manifest = join(project, "node_modules", "ms", "package.json");

		writeFileSync(store, `${JSON.stringify({ name: "ms", version: "2.1.3" })}\n`);
		mkdirSync(join(project, "node_modules", "ms"), { recursive: true });
		linkSync(store, manifest);
		chmodSync(manifest, 0o444);

		expect(hardlinkVerificationOf(project)).toEqual({ expectedLinked: 1, mismatches: [] });
	});

	it("accepts a sealed copy of a store-linked blob", () => {
		const project = openProject();
		writeHiddenLockfile(project, { icons: "1.0.0" });
		const storeManifest = join(project, "store-icons.json");
		const storeDeclaration = join(project, "store-icons.d.ts");
		const packageDirectory = join(project, "node_modules", "icons");

		writeFileSync(storeManifest, `${JSON.stringify({ name: "icons", version: "1.0.0" })}\n`);
		writeFileSync(storeDeclaration, "export {}\n");
		mkdirSync(packageDirectory, { recursive: true });
		linkSync(storeManifest, join(packageDirectory, "package.json"));
		linkSync(storeDeclaration, join(packageDirectory, "Abc.d.ts"));
		copyFileSync(storeDeclaration, join(packageDirectory, "Zoom.d.ts"));
		chmodSync(join(packageDirectory, "package.json"), 0o444);
		chmodSync(join(packageDirectory, "Abc.d.ts"), 0o444);
		chmodSync(join(packageDirectory, "Zoom.d.ts"), 0o444);

		expect(hardlinkVerificationOf(project)).toEqual({ expectedLinked: 1, mismatches: [] });
	});

	it("reports an unsealed copy of a store-linked blob", () => {
		const project = openProject();
		writeHiddenLockfile(project, { icons: "1.0.0" });
		const storeManifest = join(project, "store-icons.json");
		const storeDeclaration = join(project, "store-icons.d.ts");
		const packageDirectory = join(project, "node_modules", "icons");
		const overflow = join(packageDirectory, "Zoom.d.ts");

		writeFileSync(storeManifest, `${JSON.stringify({ name: "icons", version: "1.0.0" })}\n`);
		writeFileSync(storeDeclaration, "export {}\n");
		mkdirSync(packageDirectory, { recursive: true });
		linkSync(storeManifest, join(packageDirectory, "package.json"));
		linkSync(storeDeclaration, join(packageDirectory, "Abc.d.ts"));
		copyFileSync(storeDeclaration, overflow);
		chmodSync(join(packageDirectory, "package.json"), 0o444);
		chmodSync(join(packageDirectory, "Abc.d.ts"), 0o444);

		const verification = hardlinkVerificationOf(project);

		expect(verification?.expectedLinked).toBe(1);
		expect(verification?.mismatches).toEqual([
			{
				location: "node_modules/icons",
				name: "icons",
				kind: "fileNotSealed",
				path: overflow,
			},
		]);
	});

	it("accepts a sealed importer copy whose blob is not linked in this package", () => {
		const project = openProject();
		writeHiddenLockfile(project, { types: "1.0.0" });
		const storeManifest = join(project, "store-types.json");
		const packageDirectory = join(project, "node_modules", "types");
		const stub = join(packageDirectory, "abort.js");

		writeFileSync(storeManifest, `${JSON.stringify({ name: "types", version: "1.0.0" })}\n`);
		mkdirSync(packageDirectory, { recursive: true });
		linkSync(storeManifest, join(packageDirectory, "package.json"));
		writeFileSync(stub, "export {}\n");
		chmodSync(join(packageDirectory, "package.json"), 0o444);
		chmodSync(stub, 0o444);

		expect(hardlinkVerificationOf(project)).toEqual({ expectedLinked: 1, mismatches: [] });
	});

	it("reports an ignored package that is still hard-linked", () => {
		const project = openProject({ ignore: ["ms"] });
		writeHiddenLockfile(project, { ms: "2.1.3" });
		const store = join(project, "store-ms.json");
		const manifest = join(project, "node_modules", "ms", "package.json");

		writeFileSync(store, `${JSON.stringify({ name: "ms", version: "2.1.3" })}\n`);
		mkdirSync(join(project, "node_modules", "ms"), { recursive: true });
		linkSync(store, manifest);

		const verification = hardlinkVerificationOf(project);

		expect(verification?.expectedLinked).toBe(0);
		expect(verification?.mismatches).toEqual([
			{
				location: "node_modules/ms",
				name: "ms",
				kind: "ignoredStillLinked",
				path: manifest,
			},
		]);
	});

	function openProject(manifest: { ignore?: Array<string> } = {}): string {
		const root = mkdtempSync(join(tmpdir(), "znpm-verify-"));

		roots.push(root);
		writeFileSync(
			join(root, "package.json"),
			`${JSON.stringify(
				{
					name: "host",
					...(manifest.ignore === undefined ? {} : { znpm: { ignore: manifest.ignore } }),
				},
				undefined,
				"\t",
			)}\n`,
		);

		return root;
	}
});

function writeHiddenLockfile(project: string, versions: Record<string, string>): void {
	mkdirSync(join(project, "node_modules"), { recursive: true });

	const packages: Record<string, unknown> = {
		"": { name: "host" },
	};

	for (const [name, version] of Object.entries(versions)) {
		packages[`node_modules/${name}`] = {
			version,
			resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
			integrity: "sha512-abc",
		};
	}

	writeFileSync(join(project, "node_modules", ".package-lock.json"), `${JSON.stringify({ packages })}\n`);
}

function writePackage(project: string, name: string, version: string): void {
	mkdirSync(join(project, "node_modules", name), { recursive: true });
	writeFileSync(join(project, "node_modules", name, "package.json"), `${JSON.stringify({ name, version })}\n`);
}
