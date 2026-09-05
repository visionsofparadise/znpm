import { isAbsolute, relative, resolve } from "node:path";

export function isPathUnder(path: string, directory: string): boolean {
	const relativePath = relative(resolve(directory), resolve(path));

	return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}
