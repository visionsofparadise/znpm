export function npmChildEnvOf(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	return Object.fromEntries(Object.entries(env).filter(([key]) => key !== "PNPM_WORKER_SCRIPT_PATH"));
}
