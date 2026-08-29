import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { classifiedCandidatePackagesOf } from "./classifiedCandidatePackagesOf";
import { readHiddenLockfile, candidatePackagesOf, type CandidatePackage } from "./hiddenLockfile";

export interface HardlinkMismatch {
	location: string;
	name: string;
	kind: "notLinked" | "fileNotLinked" | "fileNotSealed" | "ignoredStillLinked";
	path?: string;
}

export interface HardlinkVerification {
	expectedLinked: number;
	mismatches: Array<HardlinkMismatch>;
}

export function hardlinkVerificationOf(projectDirectory: string): HardlinkVerification | undefined {
	const hiddenLockfile = readHiddenLockfile(projectDirectory);

	if (hiddenLockfile === undefined) {
		return undefined;
	}

	const { candidatePackages } = candidatePackagesOf(hiddenLockfile);
	const classified = classifiedCandidatePackagesOf(projectDirectory, candidatePackages);
	const mismatches: Array<HardlinkMismatch> = [];

	for (const candidatePackage of classified.toImport) {
		mismatches.push(mismatchOf(candidatePackage, "notLinked"));
	}

	for (const candidatePackage of classified.linked) {
		mismatches.push(
			...fileMismatchesOf(join(projectDirectory, candidatePackage.location), candidatePackage, "linked"),
		);
	}

	for (const candidatePackage of classified.ignored) {
		mismatches.push(
			...fileMismatchesOf(join(projectDirectory, candidatePackage.location), candidatePackage, "ignored"),
		);
	}

	return {
		expectedLinked: classified.linked.length + classified.toImport.length,
		mismatches,
	};
}

function fileMismatchesOf(
	packageDirectory: string,
	candidatePackage: CandidatePackage,
	expectation: "linked" | "ignored",
): Array<HardlinkMismatch> {
	if (!existsSync(packageDirectory)) {
		return [];
	}

	const mismatches: Array<HardlinkMismatch> = [];
	const files: Array<{ path: string; nlink: number; size: number; mode: number }> = [];

	for (const filePath of packageFilesOf(packageDirectory)) {
		const stats = statSync(filePath, { throwIfNoEntry: false });

		if (stats === undefined) {
			continue;
		}

		files.push({ path: filePath, nlink: stats.nlink, size: stats.size, mode: stats.mode & 0o777 });
	}

	if (expectation === "ignored") {
		for (const file of files) {
			if (file.nlink >= 2) {
				mismatches.push(mismatchOf(candidatePackage, "ignoredStillLinked", file.path));
			}
		}

		return mismatches;
	}

	const linkedHashesBySize = new Map<number, Set<string>>();

	for (const file of files) {
		if (file.nlink < 2) {
			if (linkedContentHashesOf(files, file.size, linkedHashesBySize).has(contentHashOf(file.path))) {
				if (file.mode !== 0o444 && file.mode !== 0o555) {
					mismatches.push(mismatchOf(candidatePackage, "fileNotSealed", file.path));
				}

				continue;
			}

			mismatches.push(mismatchOf(candidatePackage, "fileNotLinked", file.path));

			continue;
		}

		if (file.mode !== 0o444 && file.mode !== 0o555) {
			mismatches.push(mismatchOf(candidatePackage, "fileNotSealed", file.path));
		}
	}

	return mismatches;
}

function linkedContentHashesOf(
	files: Array<{ path: string; nlink: number; size: number }>,
	size: number,
	cache: Map<number, Set<string>>,
): Set<string> {
	const cached = cache.get(size);

	if (cached !== undefined) {
		return cached;
	}

	const hashes = new Set<string>();

	for (const file of files) {
		if (file.nlink >= 2 && file.size === size) {
			hashes.add(contentHashOf(file.path));
		}
	}

	cache.set(size, hashes);

	return hashes;
}

function contentHashOf(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function packageFilesOf(directory: string): Array<string> {
	const files: Array<string> = [];

	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.isSymbolicLink() || entry.name === "node_modules") {
			continue;
		}

		const entryPath = join(directory, entry.name);

		if (entry.isDirectory()) {
			files.push(...packageFilesOf(entryPath));

			continue;
		}

		files.push(entryPath);
	}

	return files;
}

function mismatchOf(candidatePackage: CandidatePackage, kind: HardlinkMismatch["kind"], path?: string): HardlinkMismatch {
	return {
		location: candidatePackage.location,
		name: candidatePackage.name,
		kind,
		...(path === undefined ? {} : { path }),
	};
}
