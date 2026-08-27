export function runCli(main: () => void | Promise<void>): void {
	try {
		const result = main();

		if (result instanceof Promise) {
			void result.catch(exitFromError);
		}
	} catch (error: unknown) {
		exitFromError(error);
	}
}

function exitFromError(error: unknown): void {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
