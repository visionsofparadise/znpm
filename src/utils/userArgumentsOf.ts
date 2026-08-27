import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function userArgumentsOf(argv: Array<string>, scriptUrl: string): Array<string> {
	const scriptPath = fileURLToPath(scriptUrl);
	const scriptIndex = argv.findIndex((argument, index) => index > 0 && pathsEqual(argument, scriptPath));

	return scriptIndex === -1 ? argv.slice(1) : argv.slice(scriptIndex + 1);
}

function pathsEqual(left: string, right: string): boolean {
	const normalizedLeft = resolve(left);
	const normalizedRight = resolve(right);

	if (process.platform === "win32") {
		return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
	}

	return normalizedLeft === normalizedRight;
}
