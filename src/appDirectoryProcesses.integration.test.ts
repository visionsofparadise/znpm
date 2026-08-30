import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { readState, writeState } from "./appData";
import { runningAppDirectoryProcessesOf } from "./appDirectoryProcessesOf";

const znpmScript = fileURLToPath(new URL("./znpm.ts", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");

describe("runningAppDirectoryProcessesOf", { timeout: 60_000 }, () => {
	const workspaces: Array<string> = [];
	const children: Array<ChildProcess> = [];

	afterEach(() => {
		for (const child of children.splice(0)) {
			stop(child);
		}

		for (const root of workspaces.splice(0)) {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("finds a process whose executable is under the app directory", async () => {
		const { appDirectory, child } = await openHeldProcess();

		expect(child.pid).toBeDefined();
		expect(
			runningAppDirectoryProcessesOf(appDirectory).some((processExecutable) => processExecutable.pid === child.pid),
		).toBe(true);
	});

	it("leaves uninstall unchanged while that process is running", async () => {
		const { appDirectory, child, localAppData, root } = await openHeldProcess();

		writeState(appDirectory, { enabled: true, changes: [], npmPath: "C:\\Program Files\\nodejs\\npm.cmd" });

		const result = spawnSync(process.execPath, ["--import", tsxLoader, znpmScript, "uninstall"], {
			encoding: "utf8",
			env: {
				...process.env,
				LOCALAPPDATA: localAppData,
				HOME: root,
			},
			timeout: 30_000,
		});

		expect(result.status).toBe(1);
		expect(result.stderr).toContain("is still running");
		expect(result.stderr).toContain(String(child.pid));
		expect(readState(appDirectory).enabled).toBe(true);
		expect(child.exitCode).toBeNull();
	});

	async function openHeldProcess(): Promise<{
		appDirectory: string;
		child: ChildProcess;
		held: string;
		localAppData: string;
		root: string;
	}> {
		const root = mkdtempSync(join(tmpdir(), "znpm-busy-"));

		workspaces.push(root);

		const localAppData = join(root, "Local");
		const appDirectory =
			process.platform === "win32" ? join(localAppData, "znpm") : join(root, ".local", "share", "znpm");
		const held =
			process.platform === "win32" ? join(appDirectory, "shim", "npm.exe") : join(appDirectory, "npm-wrapper");

		mkdirSync(dirname(held), { recursive: true });
		copyFileSync(process.execPath, held);

		if (process.platform !== "win32") {
			chmodSync(held, 0o755);
		}

		let spawnPath = held;

		if (process.platform !== "win32") {
			const linkDirectory = join(root, "usr", "local", "bin");

			mkdirSync(linkDirectory, { recursive: true });
			spawnPath = join(linkDirectory, "npm");
			symlinkSync(held, spawnPath);
		}

		const child = spawn(spawnPath, ["-e", "setInterval(() => {}, 1000)"], {
			stdio: "ignore",
			windowsHide: true,
		});

		children.push(child);
		await waitForHeldProcess(appDirectory, child);

		return { appDirectory, child, held, localAppData, root };
	}
});

async function waitForHeldProcess(appDirectory: string, child: ChildProcess): Promise<void> {
	const deadline = Date.now() + 30_000;

	while (Date.now() < deadline) {
		if (
			child.pid !== undefined &&
			runningAppDirectoryProcessesOf(appDirectory).some((processExecutable) => processExecutable.pid === child.pid)
		) {
			return;
		}

		await setTimeout(50);
	}

	throw new Error("znpm test found no held app-directory process");
}

function stop(child: ChildProcess): void {
	if (child.pid === undefined) {
		return;
	}

	child.kill();

	if (process.platform === "win32") {
		spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
	}
}
