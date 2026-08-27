import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createNewStoreController } from "@pnpm/store-connection-manager";
import { getStorePath } from "@pnpm/store-path";
import { finishWorkers } from "@pnpm/worker";
import { detachPackageDirectory } from "./detach";
import { readHiddenLockfile, wantedPackagesOf, type Resolution, type WantedPackage } from "./hiddenLockfile";
import { cacacheTarballPathOf } from "./npmCache";
import { sealPackageDirectory } from "./seal";
import { storeControllerOptionsOf } from "./storeController";

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
	alreadyLinked: number;
	imported: number;
	failed: number;
	cacheMisses: number;
	storeDirectory: string;
}

export async function convert(
	projectDirectory: string,
	options: { storeDirectory?: string; pnpmHomeDirectory: string; npmCacheDirectory: string },
): Promise<ConvertSummary> {
	const storeDirectory = await getStorePath({
		pkgRoot: projectDirectory,
		storePath: options.storeDirectory,
		pnpmHomeDir: options.pnpmHomeDirectory,
	});
	const hiddenLockfile = readHiddenLockfile(projectDirectory);

	if (hiddenLockfile === undefined) {
		return emptySummary(storeDirectory);
	}

	const { wanted, notATarball } = wantedPackagesOf(hiddenLockfile);
	const ignoreNames = ignoreNamesOf(projectDirectory);
	const unplaced: Array<WantedPackage> = [];
	const ignored: Array<WantedPackage> = [];
	const symlinked: Array<WantedPackage> = [];
	const selfBuilding: Array<WantedPackage> = [];
	const stale: Array<WantedPackage> = [];
	const alreadyLinked: Array<WantedPackage> = [];
	const toImport: Array<WantedPackage> = [];

	for (const wantedPackage of wanted) {
		const packageDirectory = join(projectDirectory, wantedPackage.location);

		if (!isPlaced(packageDirectory)) {
			unplaced.push(wantedPackage);

			continue;
		}

		if (ignoreNames.has(wantedPackage.name)) {
			ignored.push(wantedPackage);

			continue;
		}

		if (isSymbolicLink(packageDirectory)) {
			symlinked.push(wantedPackage);

			continue;
		}

		if (isSelfBuilding(packageDirectory)) {
			selfBuilding.push(wantedPackage);

			continue;
		}

		if (isStale(packageDirectory, wantedPackage.version)) {
			stale.push(wantedPackage);

			continue;
		}

		if (isAlreadyLinked(packageDirectory, wantedPackage.version)) {
			alreadyLinked.push(wantedPackage);

			continue;
		}

		toImport.push(wantedPackage);
	}

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
		await finishWorkers();
	}

	return {
		entries: packageEntryCountOf(hiddenLockfile),
		tarballs: wanted.length,
		notATarball,
		unplaced: unplaced.length,
		stale: stale.length,
		ignored: ignored.length,
		detachedFiles,
		symlinked: symlinked.length,
		selfBuilding: selfBuilding.length,
		alreadyLinked: alreadyLinked.length,
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
		alreadyLinked: 0,
		imported: 0,
		failed: 0,
		cacheMisses: 0,
		storeDirectory,
	};
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

		return Boolean(scripts.install ?? scripts.preinstall ?? scripts.postinstall ?? scripts.prepare);
	} catch {
		return false;
	}
}

function isStale(packageDirectory: string, wantedVersion: string | undefined): boolean {
	if (wantedVersion === undefined) {
		return false;
	}

	return manifestVersionOf(packageDirectory) !== wantedVersion;
}

function isAlreadyLinked(packageDirectory: string, wantedVersion: string | undefined): boolean {
	const manifestPath = join(packageDirectory, "package.json");

	try {
		if (statSync(manifestPath).nlink < 2) {
			return false;
		}

		const version = manifestVersionOf(packageDirectory);

		return wantedVersion === undefined || version === wantedVersion;
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

function packageEntryCountOf(hiddenLockfile: unknown): number {
	if (!isRecord(hiddenLockfile) || !isRecord(hiddenLockfile.packages)) {
		return 0;
	}

	return Object.keys(hiddenLockfile.packages).length;
}

function batchesByDepthOf(wantedPackages: Array<WantedPackage>): Map<number, Array<WantedPackage>> {
	const batches = new Map<number, Array<WantedPackage>>();

	for (const wantedPackage of wantedPackages) {
		const depth = (wantedPackage.location.match(/(^|\/)node_modules(\/|$)/g) ?? []).length;
		const batch = batches.get(depth);

		if (batch === undefined) {
			batches.set(depth, [wantedPackage]);
		} else {
			batch.push(wantedPackage);
		}
	}

	return batches;
}

function fetchResolutionOf(
	wantedPackage: WantedPackage,
	npmCacheDirectory: string,
): { resolution: Resolution; cacheMiss: boolean } {
	if (!("tarball" in wantedPackage.resolution)) {
		return { resolution: wantedPackage.resolution, cacheMiss: false };
	}

	const cacachePath = cacacheTarballPathOf(npmCacheDirectory, wantedPackage.resolution.integrity);

	if (cacachePath !== undefined && existsSync(cacachePath)) {
		return {
			resolution: { tarball: `file:${resolve(cacachePath)}`, integrity: wantedPackage.resolution.integrity },
			cacheMiss: false,
		};
	}

	return { resolution: wantedPackage.resolution, cacheMiss: true };
}

type StoreController = Awaited<ReturnType<typeof createNewStoreController>>["ctrl"];

async function importBatch(
	batch: Array<WantedPackage>,
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
	const workerCount = 20;

	const worker = async (): Promise<void> => {
		for (;;) {
			const index = cursor++;

			if (index >= batch.length) {
				return;
			}

			const wantedPackage = batch[index];

			if (wantedPackage === undefined) {
				return;
			}

			const { resolution, cacheMiss } = fetchResolutionOf(wantedPackage, options.npmCacheDirectory);

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
						id: `${wantedPackage.name}@${wantedPackage.version}`,
						name: wantedPackage.name,
						version: wantedPackage.version,
						resolution,
					},
				});

				if (fetchResponse instanceof Promise) {
					fetchResponse = await fetchResponse;
				}

				const files = (await fetchResponse.fetching()).files;

				await options.storeController.importPackage(join(options.projectDirectory, wantedPackage.location), {
					filesResponse: files,
					force: true,
					keepModulesDir: true,
					requiresBuild: false,
				});
				sealPackageDirectory(join(options.projectDirectory, wantedPackage.location));
				imported++;
			} catch {
				failed++;
			}
		}
	};

	await Promise.all(Array.from({ length: workerCount }, worker));

	return { imported, failed, cacheMisses };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
