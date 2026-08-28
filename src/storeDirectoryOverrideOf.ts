import { resolve } from "node:path";

export function storeDirectoryOverrideOf(env: NodeJS.ProcessEnv): string | undefined {
	const value = env.ZNPM_STORE_DIR;

	if (value === undefined || value === "") {
		return undefined;
	}

	return resolve(value);
}
