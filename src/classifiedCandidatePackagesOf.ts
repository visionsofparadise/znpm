import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "./utils/isRecord";
import type { CandidatePackage } from "./hiddenLockfile";

export interface ClassifiedCandidatePackages {
	unplaced: Array<CandidatePackage>;
	ignored: Array<CandidatePackage>;
	symlinked: Array<CandidatePackage>;
	selfBuilding: Array<CandidatePackage>;
	stale: Array<CandidatePackage>;
	linked: Array<CandidatePackage>;
	toImport: Array<CandidatePackage>;
}

export function classifiedCandidatePackagesOf(
	projectDirectory: string,
	candidatePackages: Array<CandidatePackage>,
): ClassifiedCandidatePackages {
	const ignoreNames = ignoreNamesOf(projectDirectory);
	const unplaced: Array<CandidatePackage> = [];
	const ignored: Array<CandidatePackage> = [];
	const symlinked: Array<CandidatePackage> = [];
	const selfBuilding: Array<CandidatePackage> = [];
	const stale: Array<CandidatePackage> = [];
	const linked: Array<CandidatePackage> = [];
	const toImport: Array<CandidatePackage> = [];

	for (const candidatePackage of candidatePackages) {
		const packageDirectory = join(projectDirectory, candidatePackage.location);

		if (!isPlaced(packageDirectory)) {
			unplaced.push(candidatePackage);

			continue;
		}

		if (ignoreNames.has(candidatePackage.name)) {
			ignored.push(candidatePackage);

			continue;
		}

		if (isSymbolicLink(packageDirectory)) {
			symlinked.push(candidatePackage);

			continue;
		}

		if (isSelfBuilding(packageDirectory)) {
			selfBuilding.push(candidatePackage);

			continue;
		}

		if (isStale(packageDirectory, candidatePackage.version)) {
			stale.push(candidatePackage);

			continue;
		}

		if (isLinked(packageDirectory, candidatePackage.version)) {
			linked.push(candidatePackage);

			continue;
		}

		toImport.push(candidatePackage);
	}

	return { unplaced, ignored, symlinked, selfBuilding, stale, linked, toImport };
}

function ignoreNamesOf(projectDirectory: string): Set<string> {
	try {
		const manifest: unknown = JSON.parse(readFileSync(join(projectDirectory, "package.json"), "utf8"));

		if (!isRecord(manifest) || !isRecord(manifest.znpm) || !Array.isArray(manifest.znpm.ignore)) {
			return new Set();
		}

		return new Set(manifest.znpm.ignore.filter((name): name is string => typeof name === "string"));
	} catch {
		return new Set();
	}
}

function isPlaced(packageDirectory: string): boolean {
	return existsSync(join(packageDirectory, "package.json"));
}

function isSymbolicLink(packageDirectory: string): boolean {
	const stats = lstatSync(packageDirectory, { throwIfNoEntry: false });

	return stats?.isSymbolicLink() === true;
}

function isSelfBuilding(packageDirectory: string): boolean {
	if (existsSync(join(packageDirectory, "binding.gyp"))) {
		return true;
	}

	try {
		const manifest: unknown = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"));
		const scripts = isRecord(manifest) && isRecord(manifest.scripts) ? manifest.scripts : {};

		return ["install", "preinstall", "postinstall", "prepare"].some((name) => {
			const script = scripts[name];

			return typeof script === "string" && script !== "";
		});
	} catch {
		return false;
	}
}

function isStale(packageDirectory: string, candidatePackageVersion: string | undefined): boolean {
	if (candidatePackageVersion === undefined) {
		return false;
	}

	return manifestVersionOf(packageDirectory) !== candidatePackageVersion;
}

function isLinked(packageDirectory: string, candidatePackageVersion: string | undefined): boolean {
	const manifestPath = join(packageDirectory, "package.json");

	try {
		const mode = statSync(manifestPath).mode & 0o777;

		if (mode !== 0o444 && mode !== 0o555) {
			return false;
		}

		const version = manifestVersionOf(packageDirectory);

		return candidatePackageVersion === undefined || version === candidatePackageVersion;
	} catch {
		return true;
	}
}

function manifestVersionOf(packageDirectory: string): string | undefined {
	try {
		const manifest: unknown = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"));

		if (isRecord(manifest) && typeof manifest.version === "string") {
			return manifest.version;
		}

		return undefined;
	} catch {
		return undefined;
	}
}
