import { chmodSync, linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classifiedCandidatePackagesOf } from "./classifiedCandidatePackagesOf";
import { type CandidatePackage } from "./hiddenLockfile";

describe("classifiedCandidatePackagesOf", () => {
	const roots: Array<string> = [];

	afterEach(() => {
		for (const root of roots.splice(0)) {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("returns empty buckets for no candidate packages", () => {
		const project = openProject();

		expect(classifiedCandidatePackagesOf(project, [])).toEqual({
			unplaced: [],
			ignored: [],
			symlinked: [],
			selfBuilding: [],
			stale: [],
			linked: [],
			toImport: [],
		});
	});

	it("classifies a missing package.json as unplaced", () => {
		const project = openProject();
		const candidatePackages = [candidatePackageOf("missing")];

		expect(classifiedCandidatePackagesOf(project, candidatePackages).unplaced).toEqual(candidatePackages);
	});

	it("classifies znpm.ignore names as ignored ahead of other traits", () => {
		const project = openProject({ ignore: ["self-building"] });
		writePackage(project, "self-building", {
			version: "1.0.0",
			scripts: { install: "node build.js" },
		});
		const candidatePackages = [candidatePackageOf("self-building")];

		expect(classifiedCandidatePackagesOf(project, candidatePackages).ignored).toEqual(candidatePackages);
		expect(classifiedCandidatePackagesOf(project, candidatePackages).selfBuilding).toEqual([]);
	});

	it("classifies a directory symlink as symlinked", () => {
		const project = openProject();
		const target = join(project, "real-dep");

		mkdirSync(target);
		writeFileSync(join(target, "package.json"), `${JSON.stringify({ name: "linked-dep", version: "1.0.0" })}\n`);
		mkdirSync(join(project, "node_modules"));
		symlinkSync(
			target,
			join(project, "node_modules", "linked-dep"),
			process.platform === "win32" ? "junction" : "dir",
		);

		const candidatePackages = [candidatePackageOf("linked-dep")];

		expect(classifiedCandidatePackagesOf(project, candidatePackages).symlinked).toEqual(candidatePackages);
	});

	it("classifies install scripts and binding.gyp as self-building", () => {
		const project = openProject();
		writePackage(project, "with-script", { version: "1.0.0", scripts: { postinstall: "node build.js" } });
		writePackage(project, "with-gyp", { version: "1.0.0" });
		writeFileSync(join(project, "node_modules", "with-gyp", "binding.gyp"), "{}\n");

		expect(classifiedCandidatePackagesOf(project, [candidatePackageOf("with-script")]).selfBuilding).toEqual([
			candidatePackageOf("with-script"),
		]);
		expect(classifiedCandidatePackagesOf(project, [candidatePackageOf("with-gyp")]).selfBuilding).toEqual([
			candidatePackageOf("with-gyp"),
		]);
	});

	it("classifies a shipped .node file as self-building", () => {
		const project = openProject();
		writePackage(project, "native-addon", { version: "1.0.0" });
		writeFileSync(join(project, "node_modules", "native-addon", "addon.node"), "");

		expect(classifiedCandidatePackagesOf(project, [candidatePackageOf("native-addon")]).selfBuilding).toEqual([
			candidatePackageOf("native-addon"),
		]);
	});

	it("classifies a version mismatch as stale", () => {
		const project = openProject();
		writePackage(project, "stale-pkg", { version: "1.0.0" });
		const candidatePackages = [candidatePackageOf("stale-pkg", { version: "2.0.0" })];

		expect(classifiedCandidatePackagesOf(project, candidatePackages).stale).toEqual(candidatePackages);
	});

	it("classifies a sealed matching manifest as linked", () => {
		const project = openProject();
		const storeManifest = join(project, "store-package.json");
		const manifest = join(project, "node_modules", "shared", "package.json");

		writeFileSync(storeManifest, `${JSON.stringify({ name: "shared", version: "1.0.0" })}\n`);
		mkdirSync(join(project, "node_modules", "shared"), { recursive: true });
		linkSync(storeManifest, manifest);
		chmodSync(manifest, 0o444);

		const candidatePackages = [candidatePackageOf("shared")];

		expect(classifiedCandidatePackagesOf(project, candidatePackages).linked).toEqual(candidatePackages);
	});

	it("classifies a sealed importer copy of the manifest as linked", () => {
		const project = openProject();

		writePackage(project, "copied", { version: "1.0.0" });
		chmodSync(join(project, "node_modules", "copied", "package.json"), 0o444);

		const candidatePackages = [candidatePackageOf("copied")];

		expect(classifiedCandidatePackagesOf(project, candidatePackages).linked).toEqual(candidatePackages);
	});

	it("classifies a hard-linked unsealed manifest as toImport", () => {
		const project = openProject();
		const storeManifest = join(project, "store-package.json");

		writeFileSync(storeManifest, `${JSON.stringify({ name: "unsealed", version: "1.0.0" })}\n`);
		mkdirSync(join(project, "node_modules", "unsealed"), { recursive: true });
		linkSync(storeManifest, join(project, "node_modules", "unsealed", "package.json"));

		const candidatePackages = [candidatePackageOf("unsealed")];

		expect(classifiedCandidatePackagesOf(project, candidatePackages).toImport).toEqual(candidatePackages);
	});

	it("classifies a placed unshared tarball as toImport", () => {
		const project = openProject();
		writePackage(project, "plain", { version: "1.0.0" });
		const candidatePackages = [candidatePackageOf("plain")];

		expect(classifiedCandidatePackagesOf(project, candidatePackages).toImport).toEqual(candidatePackages);
	});

	function openProject(manifest: { ignore?: Array<string> } = {}): string {
		const root = mkdtempSync(join(tmpdir(), "znpm-classify-"));

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

function candidatePackageOf(name: string, overrides: Partial<CandidatePackage> = {}): CandidatePackage {
	return {
		location: `node_modules/${name}`,
		name,
		version: "1.0.0",
		resolution: { tarball: `https://example.com/${name}-1.0.0.tgz`, integrity: "sha512-abc" },
		...overrides,
	};
}

function writePackage(project: string, name: string, manifest: Record<string, unknown>): void {
	const directory = join(project, "node_modules", name);

	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, "package.json"), `${JSON.stringify({ name, ...manifest })}\n`);
}
