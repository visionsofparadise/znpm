const treeMutatingCommands = new Set([
	"install",
	"ci",
	"uninstall",
	"update",
	"dedupe",
	"prune",
	"rebuild",
	"link",
	"install-test",
	"install-ci-test",
]);

const commandByAlias: Record<string, string> = {
	install: "install",
	add: "install",
	i: "install",
	in: "install",
	ins: "install",
	inst: "install",
	insta: "install",
	instal: "install",
	isnt: "install",
	isnta: "install",
	isntal: "install",
	isntall: "install",
	ci: "ci",
	"clean-install": "ci",
	ic: "ci",
	"install-clean": "ci",
	"isntall-clean": "ci",
	uninstall: "uninstall",
	unlink: "uninstall",
	remove: "uninstall",
	rm: "uninstall",
	r: "uninstall",
	un: "uninstall",
	update: "update",
	u: "update",
	up: "update",
	upgrade: "update",
	udpate: "update",
	dedupe: "dedupe",
	ddp: "dedupe",
	prune: "prune",
	rebuild: "rebuild",
	rb: "rebuild",
	link: "link",
	ln: "link",
	"install-test": "install-test",
	it: "install-test",
	"install-ci-test": "install-ci-test",
	cit: "install-ci-test",
	"clean-install-test": "install-ci-test",
	sit: "install-ci-test",
	audit: "audit",
};

const valueFlags = new Set([
	"C",
	"before",
	"cache",
	"cpu",
	"fetch-retries",
	"fetch-retry-factor",
	"fetch-retry-maxtimeout",
	"fetch-retry-mintimeout",
	"fetch-timeout",
	"globalconfig",
	"include",
	"install-strategy",
	"libc",
	"location",
	"loglevel",
	"logs-dir",
	"logs-max",
	"omit",
	"os",
	"otp",
	"prefix",
	"registry",
	"tag",
	"user",
	"userconfig",
	"w",
	"workspace",
]);

export function isTreeMutatingNpmCommand(argv: Array<string>, env: NodeJS.ProcessEnv = process.env): boolean {
	const invocation = npmInvocationOf(argv, env);

	if (invocation.global || invocation.dryRun || invocation.help) {
		return false;
	}

	if (invocation.command === "audit") {
		return invocation.positionals[1] === "fix";
	}

	return invocation.command !== undefined && treeMutatingCommands.has(invocation.command);
}

function npmInvocationOf(
	argv: Array<string>,
	env: NodeJS.ProcessEnv,
): { command: string | undefined; positionals: Array<string>; global: boolean; dryRun: boolean; help: boolean } {
	const positionals: Array<string> = [];
	let global = envTrue(env.npm_config_global) || env.npm_config_location === "global";
	let dryRun = envTrue(env.npm_config_dry_run);
	let help = false;

	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];

		if (argument === undefined) {
			continue;
		}

		if (argument === "--") {
			positionals.push(...argv.slice(index + 1));

			break;
		}

		if (argument === "--help" || argument === "-h" || argument === "-?" || argument === "--usage") {
			help = true;

			continue;
		}

		if (argument === "--dry-run") {
			dryRun = true;

			continue;
		}

		if (argument === "--no-dry-run") {
			dryRun = false;

			continue;
		}

		if (argument === "-g" || argument === "--global") {
			global = true;

			continue;
		}

		if (argument === "--no-global") {
			global = false;

			continue;
		}

		if (argument.startsWith("--location=")) {
			global = argument.slice("--location=".length) === "global";

			continue;
		}

		if (argument.startsWith("--dry-run=")) {
			dryRun = argument.slice("--dry-run=".length) !== "false";

			continue;
		}

		if (argument.startsWith("--global=")) {
			global = argument.slice("--global=".length) !== "false";

			continue;
		}

		if (argument.startsWith("--") && argument.includes("=")) {
			continue;
		}

		if (argument.startsWith("-")) {
			const flagName = argument.startsWith("--") ? argument.slice(2) : argument.slice(1);

			if (flagName === "location") {
				const value = argv[index + 1];

				global = value === "global";
				index++;

				continue;
			}

			if (valueFlags.has(flagName)) {
				index++;
			}

			continue;
		}

		positionals.push(argument);
	}

	const rawCommand = positionals[0];
	const command = rawCommand === undefined ? undefined : commandByAlias[rawCommand];

	return { command, positionals, global, dryRun, help };
}

function envTrue(value: string | undefined): boolean {
	return value === "true" || value === "1";
}
