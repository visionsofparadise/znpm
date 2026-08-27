export function runCli(main: () => void): void {
	try {
		main();
	} catch (error: unknown) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
