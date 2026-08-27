import { dirname } from "node:path";

interface BunGlobal {
	main: string;
}

export function setPnpmWorkerScriptPath(): void {
	if (process.versions.bun === undefined) {
		return;
	}

	const bunGlobal = (globalThis as typeof globalThis & { Bun: BunGlobal }).Bun;

	process.env.PNPM_WORKER_SCRIPT_PATH = `${dirname(bunGlobal.main).replaceAll("\\", "/")}/node_modules/@pnpm/worker/lib/worker.js`;
}
