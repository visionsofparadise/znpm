export function npmVersionLineOf(stdout: string): string {
	const body = stdout.replace(/\r?\n$/, "");

	if (body === "") {
		return stdout;
	}

	return `${body} (znpm)\n`;
}
