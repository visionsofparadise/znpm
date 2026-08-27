import { homedir } from "node:os";
import { join } from "node:path";

export function npmCacheDirectoryOf(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
	if (env.npm_config_cache !== undefined && env.npm_config_cache !== "") {
		return env.npm_config_cache;
	}

	if (platform === "win32") {
		return join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "npm-cache");
	}

	return join(homedir(), ".npm");
}

export function cacacheTarballPathOf(cacheDirectory: string, integrity: string): string | undefined {
	const sha512Member = integrity.split(/\s+/).find((member) => member.startsWith("sha512-"));

	if (sha512Member === undefined) {
		return undefined;
	}

	const hex = Buffer.from(sha512Member.slice("sha512-".length), "base64").toString("hex");

	return join(cacheDirectory, "_cacache", "content-v2", "sha512", hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
}
