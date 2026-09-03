import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { copyFile, link } from "node:fs/promises";
import { dirname, join } from "node:path";

export type ImportOutcome = "imported" | "locked";

export async function importPackageDirectory(
	packageDirectory: string,
	filesMap: Record<string, string>,
): Promise<ImportOutcome> {
	const stage = siblingOf(packageDirectory, "znpm-stage");

	try {
		await stagePackage(stage, filesMap);
	} catch (error) {
		removeCreatedDirectory(stage);

		throw error;
	}

	const aside = siblingOf(packageDirectory, "znpm-aside");

	try {
		renameSync(packageDirectory, aside);
	} catch {
		removeCreatedDirectory(stage);

		return "locked";
	}

	try {
		renameSync(stage, packageDirectory);
		keepNestedModules(aside, packageDirectory);
	} catch {
		restoreAside(packageDirectory, aside);
		removeCreatedDirectory(stage);

		return "locked";
	}

	removeAsideDirectory(aside);

	return "imported";
}

function siblingOf(packageDirectory: string, kind: string): string {
	return `${packageDirectory}.${process.pid}.${randomBytes(4).toString("hex")}.${kind}`;
}

async function stagePackage(stage: string, filesMap: Record<string, string>): Promise<void> {
	mkdirSync(stage, { recursive: true });

	for (const relativePath of Object.keys(filesMap)) {
		mkdirSync(dirname(join(stage, relativePath)), { recursive: true });
	}

	for (const [relativePath, storePath] of Object.entries(filesMap)) {
		await linkOrCopy(storePath, join(stage, relativePath));
	}
}

async function linkOrCopy(storePath: string, dest: string): Promise<void> {
	try {
		await link(storePath, dest);
	} catch (error) {
		if (isErrno(error, "EEXIST")) {
			return;
		}

		await copyFile(storePath, dest);
	}
}

function keepNestedModules(aside: string, packageDirectory: string): void {
	const from = join(aside, "node_modules");
	const to = join(packageDirectory, "node_modules");

	if (!existsSync(from)) {
		return;
	}

	if (!existsSync(to)) {
		renameSync(from, to);

		return;
	}

	for (const name of readdirSync(from)) {
		const dest = join(to, name);

		if (!existsSync(dest)) {
			renameSync(join(from, name), dest);
		}
	}
}

function restoreAside(packageDirectory: string, aside: string): void {
	if (existsSync(packageDirectory)) {
		rmSync(packageDirectory, { recursive: true, force: true, maxRetries: 3 });
	}

	if (existsSync(aside) && !existsSync(packageDirectory)) {
		renameSync(aside, packageDirectory);
	}
}

function removeCreatedDirectory(directory: string): void {
	try {
		rmSync(directory, { recursive: true, force: true });
	} catch {
		return;
	}
}

function removeAsideDirectory(directory: string): void {
	try {
		rmSync(directory, { recursive: true, force: true });
	} catch (error) {
		if (isErrno(error, "EPERM") || isErrno(error, "EBUSY") || isErrno(error, "EACCES")) {
			return;
		}

		throw error;
	}
}

function isErrno(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}
