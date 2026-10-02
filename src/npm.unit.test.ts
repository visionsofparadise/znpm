import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { npmPathOf } from "./npm";

describe("npmPathOf", () => {
	let appDirectory: string;

	beforeEach(() => {
		appDirectory = mkdtempSync(join(tmpdir(), "znpm-npm-"));
	});

	afterEach(() => {
		rmSync(appDirectory, { recursive: true, force: true });
	});

	it("names npm as what znpm depends on when it finds none", () => {
		expect(() => npmPathOf({ PATH: "" }, appDirectory)).toThrow(/znpm wraps npm and depends on it/);
	});

	it("tells the reader to install npm and run enable", () => {
		expect(() => npmPathOf({ PATH: "" }, appDirectory)).toThrow(/Install Node\.js and npm, then run znpm enable\./);
	});

	it("skips a legacy shim npm under the app directory for the real npm after it on PATH", () => {
		const npmName = process.platform === "win32" ? "npm.cmd" : "npm";
		const shimDirectory = join(appDirectory, "shim");
		const realDirectory = `${appDirectory}-real`;

		mkdirSync(shimDirectory, { recursive: true });
		mkdirSync(realDirectory, { recursive: true });
		writeFileSync(join(shimDirectory, npmName), "");
		writeFileSync(join(realDirectory, npmName), "");

		try {
			expect(npmPathOf({ PATH: [shimDirectory, realDirectory].join(delimiter) }, appDirectory)).toBe(
				join(realDirectory, npmName),
			);
		} finally {
			rmSync(realDirectory, { recursive: true, force: true });
		}
	});

	it("ignores a recorded npm under the app directory", () => {
		writeFileSync(
			join(appDirectory, "state.json"),
			JSON.stringify({ enabled: true, changes: [], npmPath: join(appDirectory, "shim", "npm.cmd") }),
		);

		expect(() => npmPathOf({ PATH: "" }, appDirectory)).toThrow(/znpm wraps npm and depends on it/);
	});
});
