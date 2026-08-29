import { chmodSync, statSync } from "node:fs";
import { packageFilesOf } from "./packageFilesOf";

export function sealPackageDirectory(directory: string): void {
	for (const filePath of packageFilesOf(directory)) {
		try {
			const executable = (statSync(filePath).mode & 0o111) !== 0;

			chmodSync(filePath, executable ? 0o555 : 0o444);
		} catch {
			continue;
		}
	}
}
