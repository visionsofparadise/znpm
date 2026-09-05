export function powershellSingleQuote(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}
