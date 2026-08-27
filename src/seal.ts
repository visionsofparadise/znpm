import { chmodSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export function sealPackageDirectory(directory: string): void {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.isSymbolicLink() || entry.name === "node_modules") {
			continue;
		}

		const entryPath = join(directory, entry.name);

		if (entry.isDirectory()) {
			sealPackageDirectory(entryPath);

			continue;
		}

		try {
			const executable = (statSync(entryPath).mode & 0o111) !== 0;

			chmodSync(entryPath, executable ? 0o555 : 0o444);
		} catch {
			continue;
		}
	}
}
