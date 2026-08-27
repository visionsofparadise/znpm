import { chmodSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function detachPackageDirectory(directory: string): number {
	let detachedFiles = 0;

	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.isSymbolicLink()) {
			continue;
		}

		if (entry.name === "node_modules") {
			continue;
		}

		const entryPath = join(directory, entry.name);

		if (entry.isDirectory()) {
			detachedFiles += detachPackageDirectory(entryPath);

			continue;
		}

		if (statSync(entryPath).nlink < 2) {
			chmodSync(entryPath, 0o666);

			continue;
		}

		const detachedPath = `${entryPath}.znpm-detach`;

		writeFileSync(detachedPath, readFileSync(entryPath));
		chmodSync(detachedPath, 0o666);
		unlinkSync(entryPath);
		renameSync(detachedPath, entryPath);
		detachedFiles++;
	}

	return detachedFiles;
}
