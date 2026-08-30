import { spawnSync } from "node:child_process";

export function runPowerShell(script: string, timeout?: number): string {
	const encoded = Buffer.from(script, "utf16le").toString("base64");
	const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
		encoding: "utf8",
		windowsHide: true,
		timeout,
	});

	if (result.error !== undefined) {
		throw result.error;
	}

	if (result.status !== 0) {
		throw new Error(result.stderr.trim() === "" ? "znpm powershell failed" : result.stderr.trim());
	}

	return result.stdout;
}
