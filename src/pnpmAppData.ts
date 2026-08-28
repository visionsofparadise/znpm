import { homedir } from "node:os";
import { join } from "node:path";

export function pnpmAppDirectoryOf(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
	if (env.PNPM_HOME !== undefined && env.PNPM_HOME !== "") {
		return env.PNPM_HOME;
	}

	if (platform === "win32") {
		return join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "pnpm");
	}

	if (platform === "darwin") {
		return join(homedir(), "Library", "pnpm");
	}

	if (env.XDG_DATA_HOME !== undefined && env.XDG_DATA_HOME !== "") {
		return join(env.XDG_DATA_HOME, "pnpm");
	}

	return join(homedir(), ".local", "share", "pnpm");
}
