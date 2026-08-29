import { readdirSync } from "node:fs";
import { join } from "node:path";

export function packageFilesOf(directory: string): Array<string> {
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
