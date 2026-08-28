import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "./utils/isRecord";

export type Resolution = { tarball: string; integrity: string } | { type: "git"; repo: string; commit: string };

export interface CandidatePackage {
	location: string;
	name: string;
	version: string | undefined;
	resolution: Resolution;
}

export function readHiddenLockfile(projectDirectory: string): unknown {
	const hiddenLockfilePath = join(projectDirectory, "node_modules", ".package-lock.json");

	if (!existsSync(hiddenLockfilePath)) {
		return undefined;
	}

	try {
		return JSON.parse(readFileSync(hiddenLockfilePath, "utf8"));
	} catch {
		console.error(`znpm could not parse ${hiddenLockfilePath}`);

		return undefined;
	}
}

export function candidatePackagesOf(hiddenLockfile: unknown): {
	candidatePackages: Array<CandidatePackage>;
	notATarball: number;
} {
	const candidatePackages: Array<CandidatePackage> = [];
	let notATarball = 0;

	for (const [location, entry] of Object.entries(packagesOf(hiddenLockfile))) {
		if (!isRecord(entry) || entry.link === true) {
			notATarball++;

			continue;
		}

		const resolved = typeof entry.resolved === "string" ? entry.resolved : "";
		const resolution = resolutionOf(resolved, entry.integrity);

		if (resolution === undefined) {
			notATarball++;

			continue;
		}

		const name =
			typeof entry.name === "string"
				? entry.name
				: location.slice(location.lastIndexOf("node_modules/") + "node_modules/".length);
		const barePackageName = name.split("/").pop();
		const tarballBasename = resolved.split("/").pop() ?? "";
		const versionFromTarball =
			barePackageName !== undefined &&
			tarballBasename.startsWith(`${barePackageName}-`) &&
			tarballBasename.endsWith(".tgz")
				? tarballBasename.slice(barePackageName.length + 1, -4)
				: undefined;

		candidatePackages.push({
			location,
			name,
			version: versionFromTarball ?? (typeof entry.version === "string" ? entry.version : undefined),
			resolution,
		});
	}

	return { candidatePackages, notATarball };
}

function packagesOf(hiddenLockfile: unknown): Record<string, unknown> {
	if (!isRecord(hiddenLockfile) || !isRecord(hiddenLockfile.packages)) {
		return {};
	}

	return hiddenLockfile.packages;
}

function resolutionOf(resolved: string, integrity: unknown): Resolution | undefined {
	if (/^git\+|^github:/.test(resolved)) {
		const hashIndex = resolved.lastIndexOf("#");

		return {
			type: "git",
			repo: resolved
				.slice(0, hashIndex)
				.replace(/^git\+/, "")
				.replace(/^ssh:\/\/git@(github\.com)\//, "https://$1/"),
			commit: resolved.slice(hashIndex + 1),
		};
	}

	if (/^https?:/.test(resolved) && typeof integrity === "string" && integrity !== "") {
		return { tarball: resolved, integrity };
	}

	return undefined;
}
