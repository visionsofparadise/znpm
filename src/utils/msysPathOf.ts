export function msysPathOf(path: string): string {
	if (!/^[A-Za-z]:[\\/]/.test(path)) {
		return path.replaceAll("\\", "/");
	}

	return `/${path.slice(0, 1).toLowerCase()}/${path.slice(3).replaceAll("\\", "/")}`;
}
