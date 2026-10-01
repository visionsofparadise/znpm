import { delimiter, dirname } from "node:path";

export function nodeFirstEnvOf(env: NodeJS.ProcessEnv, leadingDirectories: Array<string> = []): NodeJS.ProcessEnv {
	const isPathKey = (key: string): boolean =>
		process.platform === "win32" ? key.toUpperCase() === "PATH" : key === "PATH";
	const entries = Object.entries(env);
	const path = entries.find(([key, value]) => isPathKey(key) && value !== undefined && value !== "")?.[1] ?? "";

	return {
		...Object.fromEntries(entries.filter(([key]) => !isPathKey(key))),
		PATH: [...leadingDirectories, dirname(process.execPath), path].filter((entry) => entry !== "").join(delimiter),
	};
}
