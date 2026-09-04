import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readState, writeState, type PathChange, type State } from "./appData";

describe("the state file", () => {
	let temporaryRoot: string;

	beforeEach(() => {
		temporaryRoot = mkdtempSync(join(tmpdir(), "znpm-app-"));
	});

	afterEach(() => {
		rmSync(temporaryRoot, { recursive: true, force: true });
	});

	it("reads a disabled state with no changes when state.json is absent", () => {
		expect(readState(temporaryRoot)).toEqual({ enabled: false, disabled: false, changes: [], npmPath: undefined });
	});

	it("reads an absent disabled key as false", () => {
		writeFileSync(join(temporaryRoot, "state.json"), JSON.stringify({ enabled: true, changes: [] }), "utf8");

		expect(readState(temporaryRoot).disabled).toBe(false);
	});

	it("reads a recorded disabled override", () => {
		writeFileSync(
			join(temporaryRoot, "state.json"),
			JSON.stringify({ enabled: true, disabled: true, changes: [] }),
			"utf8",
		);

		expect(readState(temporaryRoot).disabled).toBe(true);
	});

	it("refuses a disabled key that is not a boolean", () => {
		writeFileSync(
			join(temporaryRoot, "state.json"),
			JSON.stringify({ enabled: true, disabled: "yes", changes: [] }),
			"utf8",
		);

		expect(() => readState(temporaryRoot)).toThrow();
	});

	it("reads every recorded change alongside the resolved npm", () => {
		const recorded = {
			enabled: true,
			disabled: false,
			changes: [
				{ target: "windowsMachinePath", entry: "C:\\znpm\\shim" },
				{ target: "windowsUserPath", entry: "C:\\znpm\\bin" },
				{ target: "posixSymlink", path: "/usr/local/bin/npm" },
			],
			npmPath: "/usr/local/lib/node/npm",
		};

		writeFileSync(join(temporaryRoot, "state.json"), JSON.stringify(recorded), "utf8");

		expect(readState(temporaryRoot)).toEqual(recorded);
	});

	it("refuses a recorded change it cannot reverse", () => {
		const recorded = { enabled: true, changes: [{ target: "registryKey", key: "Path" }] };

		writeFileSync(join(temporaryRoot, "state.json"), JSON.stringify(recorded), "utf8");

		expect(() => readState(temporaryRoot)).toThrow();
	});

	it("creates the app directory and records the state as JSON", () => {
		const appDirectory = join(temporaryRoot, "znpm");
		const changes: Array<PathChange> = [{ target: "posixSymlink", path: "/usr/local/bin/znpm" }];
		const state: State = { enabled: true, disabled: false, changes, npmPath: "/usr/local/lib/node/npm" };

		writeState(appDirectory, state);

		expect(JSON.parse(readFileSync(join(appDirectory, "state.json"), "utf8"))).toEqual(state);
	});
});
