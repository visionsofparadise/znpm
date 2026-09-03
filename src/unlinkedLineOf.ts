export function unlinkedLineOf(unlinked: number): string {
	if (unlinked === 1) {
		return "znpm: 1 package not linked to the store; node_modules is unaffected";
	}

	return `znpm: ${String(unlinked)} packages not linked to the store; node_modules is unaffected`;
}
