import { defaultExclude, defineConfig } from "vitest/config";

// The installed znpm 0.2.2 wrapper leaks its Bun-embedded worker path into npm run scripts, which breaks @pnpm/worker here.
delete process.env.PNPM_WORKER_SCRIPT_PATH;

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		exclude: [...defaultExclude, "**/.scratch/**"],
	},
});
