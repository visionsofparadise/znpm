export function quotedProcessArgumentOf(value: string): string {
	return `"${value.replaceAll('"', '\\"')}"`;
}
