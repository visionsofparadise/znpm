import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { powershellSingleQuote } from "./utils/powershellSingleQuote";
import { quotedProcessArgumentOf } from "./utils/quotedProcessArgumentOf";

export function applyMachinePathElevated(action: "insert" | "remove", entry: string): void {
	const { filePath, argumentList } = reinvocationOf(["apply-machine-path", `--${action}`, entry]);
	const script = `$process = Start-Process -FilePath ${powershellSingleQuote(filePath)} -ArgumentList ${powershellStringArray(argumentList)} -Verb RunAs -Wait -PassThru
if ($null -eq $process) { exit 1 }
exit $process.ExitCode
`;
	const encoded = Buffer.from(script, "utf16le").toString("base64");
	const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
		stdio: "inherit",
	});

	if (result.error !== undefined) {
		throw result.error;
	}

	if (result.status !== 0) {
		throw new Error("znpm could not apply the machine PATH");
	}
}

export function powershellStringArray(values: Array<string>): string {
	return `@(${values.map((value) => powershellSingleQuote(quotedProcessArgumentOf(value))).join(",")})`;
}

function reinvocationOf(commandArguments: Array<string>): { filePath: string; argumentList: Array<string> } {
	const filePath = process.execPath;
	const scriptPath = process.argv[1];
	const runningFromScript =
		scriptPath !== undefined &&
		(scriptPath.endsWith(".ts") || scriptPath.endsWith(".js") || scriptPath.endsWith(".mjs"));

	if (runningFromScript) {
		return { filePath, argumentList: [...process.execArgv, resolve(scriptPath), ...commandArguments] };
	}

	return { filePath, argumentList: commandArguments };
}
