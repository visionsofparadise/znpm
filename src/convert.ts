import { existsSync, lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { createNewStoreController } from "@pnpm/store-connection-manager";
import { getStorePath } from "@pnpm/store-path";
import { calcMaxWorkers } from "@pnpm/worker";
import { batchesByDepthOf } from "./batchesByDepthOf";
import { classifiedCandidatePackagesOf } from "./classifiedCandidatePackagesOf";
import { detachPackageDirectory } from "./detach";
import { readHiddenLockfile, candidatePackagesOf, type Resolution, type CandidatePackage } from "./hiddenLockfile";
import { cacacheTarballPathOf } from "./npmCache";
import { sealPackageDirectory } from "./seal";
import { storeControllerOptionsOf } from "./storeController";
import { isRecord } from "./utils/isRecord";

export interface ConvertSummary {
	entries: number;
	tarballs: number;
	notATarball: number;
	unplaced: number;
	stale: number;
	ignored: number;
	detachedFiles: number;
	symlinked: number;
	selfBuilding: number;
	linked: number;
	imported: number;
	failed: number;
	cacheMisses: number;
	storeDirectory: string;
}

export async function convert(
	projectDirectory: string,
	options: { storeDirectory?: string; pnpmAppDirectory: string; npmCacheDirectory: string },
): Promise<ConvertSummary> {
	const storeDirectory = await getStorePath({
		pkgRoot: projectDirectory,
		storePath: options.storeDirectory === undefined ? undefined : resolve(options.storeDirectory),
		pnpmHomeDir: options.pnpmAppDirectory,
	});
	const hiddenLockfile = readHiddenLockfile(projectDirectory);

	if (hiddenLockfile === undefined) {
		return emptySummary(storeDirectory);
	}

	const { candidatePackages, notATarball } = candidatePackagesOf(hiddenLockfile);
	const { unplaced, ignored, symlinked, selfBuilding, stale, linked, toImport } = classifiedCandidatePackagesOf(
		projectDirectory,
		candidatePackages,
	);

	let detachedFiles = 0;

	for (const ignoredPackage of ignored) {
		const packageDirectory = join(projectDirectory, ignoredPackage.location);

		if (existsSync(packageDirectory) && !isSymbolicLink(packageDirectory)) {
			detachedFiles += detachPackageDirectory(packageDirectory);
		}
	}

	let imported = 0;
	let failed = 0;
	let cacheMisses = 0;

	if (toImport.length > 0) {
		const { ctrl: storeController } = await createNewStoreController(storeControllerOptionsOf(storeDirectory));
		const batches = batchesByDepthOf(toImport);

		for (const depth of [...batches.keys()].sort((left, right) => left - right)) {
			const batch = batches.get(depth);

			if (batch === undefined) {
				continue;
			}

			const outcome = await importBatch(batch, {
				projectDirectory,
				npmCacheDirectory: options.npmCacheDirectory,
				storeController,
			});

			imported += outcome.imported;
			failed += outcome.failed;
			cacheMisses += outcome.cacheMisses;
		}

		await storeController.close();
	}

	return {
		entries: packageEntryCountOf(hiddenLockfile),
		tarballs: candidatePackages.length,
		notATarball,
		unplaced: unplaced.length,
		stale: stale.length,
		ignored: ignored.length,
		detachedFiles,
		symlinked: symlinked.length,
		selfBuilding: selfBuilding.length,
		linked: linked.length,
		imported,
		failed,
		cacheMisses,
		storeDirectory,
	};
}

function emptySummary(storeDirectory: string): ConvertSummary {
	return {
		entries: 0,
		tarballs: 0,
		notATarball: 0,
		unplaced: 0,
		stale: 0,
		ignored: 0,
		detachedFiles: 0,
		symlinked: 0,
		selfBuilding: 0,
		linked: 0,
		imported: 0,
		failed: 0,
		cacheMisses: 0,
		storeDirectory,
	};
}

function isSymbolicLink(packageDirectory: string): boolean {
	const stats = lstatSync(packageDirectory, { throwIfNoEntry: false });

	return stats?.isSymbolicLink() === true;
}

function packageEntryCountOf(hiddenLockfile: unknown): number {
	if (!isRecord(hiddenLockfile) || !isRecord(hiddenLockfile.packages)) {
		return 0;
	}

	return Object.keys(hiddenLockfile.packages).length;
}

function fetchResolutionOf(
	candidatePackage: CandidatePackage,
	npmCacheDirectory: string,
): { resolution: Resolution; cacheMiss: boolean } {
	if (!("tarball" in candidatePackage.resolution)) {
		return { resolution: candidatePackage.resolution, cacheMiss: false };
	}

	const cacachePath = cacacheTarballPathOf(npmCacheDirectory, candidatePackage.resolution.integrity);

	if (cacachePath !== undefined && existsSync(cacachePath)) {
		return {
			resolution: { tarball: `file:${resolve(cacachePath)}`, integrity: candidatePackage.resolution.integrity },
			cacheMiss: false,
		};
	}

	return { resolution: candidatePackage.resolution, cacheMiss: true };
}

type StoreController = Awaited<ReturnType<typeof createNewStoreController>>["ctrl"];

async function importBatch(
	batch: Array<CandidatePackage>,
	options: {
		projectDirectory: string;
		npmCacheDirectory: string;
		storeController: StoreController;
	},
): Promise<{ imported: number; failed: number; cacheMisses: number }> {
	let cursor = 0;
	let imported = 0;
	let failed = 0;
	let cacheMisses = 0;
	const workerCount = Math.max(1, Math.min(4, calcMaxWorkers()));

	const worker = async (): Promise<void> => {
		for (;;) {
			const index = cursor++;

			if (index >= batch.length) {
				return;
			}

			const candidatePackage = batch[index];

			if (candidatePackage === undefined) {
				return;
			}

			const { resolution, cacheMiss } = fetchResolutionOf(candidatePackage, options.npmCacheDirectory);

			if (cacheMiss) {
				cacheMisses++;
			}

			try {
				let fetchResponse = options.storeController.fetchPackage({
					force: false,
					lockfileDir: options.projectDirectory,
					ignoreScripts: true,
					// eslint-disable-next-line id-denylist
					pkg: {
						id: `${candidatePackage.name}@${candidatePackage.version}`,
						name: candidatePackage.name,
						version: candidatePackage.version,
						resolution,
					},
				});

				if (fetchResponse instanceof Promise) {
					fetchResponse = await fetchResponse;
				}

				const files = (await fetchResponse.fetching()).files;

				await options.storeController.importPackage(join(options.projectDirectory, candidatePackage.location), {
					filesResponse: files,
					force: true,
					keepModulesDir: true,
					requiresBuild: false,
				});
				sealPackageDirectory(join(options.projectDirectory, candidatePackage.location));
				imported++;
			} catch (error: unknown) {
				failed++;
				console.error(
					`znpm could not import ${candidatePackage.location}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	};

	await Promise.all(Array.from({ length: workerCount }, worker));

	return { imported, failed, cacheMisses };
}
