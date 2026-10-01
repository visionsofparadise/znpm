import { describe, expect, it } from "vitest";
import { npmChildEnvOf } from "./npmChildEnvOf";

describe("npmChildEnvOf", () => {
	it("drops the embedded pnpm worker path the wrapper set for itself", () => {
		const env = npmChildEnvOf({
			PNPM_WORKER_SCRIPT_PATH: "B:/~BUN/root/vendor/pnpm-worker/lib/worker.js",
			ZNPM_INTERNAL: "1",
			PATH: "bin",
		});

		expect(env).not.toHaveProperty("PNPM_WORKER_SCRIPT_PATH");
		expect(env).toEqual({ ZNPM_INTERNAL: "1", PATH: "bin" });
	});

	it("leaves an environment without the worker path unchanged", () => {
		expect(npmChildEnvOf({ PATH: "bin" })).toEqual({ PATH: "bin" });
	});
});
