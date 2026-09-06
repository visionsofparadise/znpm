export function windowsPathOf(path: string): string {
	if (!/^\/[A-Za-z](\/|$)/.test(path)) {
		return path;
	}

	return `${path.slice(1, 2).toUpperCase()}:\\${path.slice(3).replaceAll("/", "\\")}`;
}

export function environmentPathOf(value: string, platform: NodeJS.Platform): string {
	return platform === "win32" ? windowsPathOf(value) : value;
}
