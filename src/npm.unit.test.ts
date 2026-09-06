import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
});
