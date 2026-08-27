export async function runCli(main: () => void | Promise<void>): Promise<void> {
	try {
		await main();
	} catch (error: unknown) {
		exitFromError(error);
	}
}

function exitFromError(error: unknown): void {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
