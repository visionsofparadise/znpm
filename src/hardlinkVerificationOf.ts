import { existsSync, readdirSync, statSync } from "node:fs";
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

	for (const filePath of packageFilesOf(packageDirectory)) {
		const stats = statSync(filePath, { throwIfNoEntry: false });

		if (stats === undefined) {
			continue;
		}

		if (expectation === "ignored") {
			if (stats.nlink >= 2) {
				mismatches.push(mismatchOf(candidatePackage, "ignoredStillLinked", filePath));
			}

			continue;
		}

		if (stats.nlink < 2) {
			mismatches.push(mismatchOf(candidatePackage, "fileNotLinked", filePath));

			continue;
		}

		const mode = stats.mode & 0o777;
		const sealed = mode === 0o444 || mode === 0o555;

		if (!sealed) {
			mismatches.push(mismatchOf(candidatePackage, "fileNotSealed", filePath));
		}
	}

	return mismatches;
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
