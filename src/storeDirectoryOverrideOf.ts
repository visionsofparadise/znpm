import { resolve } from "node:path";
import { environmentPathOf } from "./utils/windowsPathOf";

export function storeDirectoryOverrideOf(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | undefined {
	const value = env.ZNPM_STORE_DIR;

	if (value === undefined || value === "") {
		return undefined;
	}

	return resolve(environmentPathOf(value, platform));
}
