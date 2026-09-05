#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const distDirectory = join(repositoryRoot, "dist");
const npmDirectory = join(distDirectory, "npm");
const sourceDirectory = join(repositoryRoot, "npm");

const manifest = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
const version = manifest.version;
const license = "MIT";
const repository = { type: "git", url: "git+https://github.com/visionsofparadise/znpm.git" };

const targets = [
	{ asset: "linux-x64", name: "@zcross/znpm-linux-x64", os: "linux", cpu: "x64", libc: "glibc" },
	{ asset: "linux-arm64", name: "@zcross/znpm-linux-arm64", os: "linux", cpu: "arm64", libc: "glibc" },
	{ asset: "linux-x64-musl", name: "@zcross/znpm-linux-x64-musl", os: "linux", cpu: "x64", libc: "musl" },
	{ asset: "linux-arm64-musl", name: "@zcross/znpm-linux-arm64-musl", os: "linux", cpu: "arm64", libc: "musl" },
	{ asset: "darwin-x64", name: "@zcross/znpm-darwin-x64", os: "darwin", cpu: "x64" },
	{ asset: "darwin-arm64", name: "@zcross/znpm-darwin-arm64", os: "darwin", cpu: "arm64" },
	{ asset: "windows-x64", name: "@zcross/znpm-win32-x64", os: "win32", cpu: "x64" },
	{ asset: "windows-arm64", name: "@zcross/znpm-win32-arm64", os: "win32", cpu: "arm64" },
];

function directoryNameOf(name) {
	return name.slice(name.indexOf("/") + 1);
}

function writeManifest(directory, value) {
	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, "package.json"), `${JSON.stringify(value, undefined, "\t")}\n`, "utf8");
}

function copyAsset(assetPath, destinationPath) {
	if (!existsSync(assetPath)) {
		console.error(`missing build asset at ${assetPath}; run node scripts/build.mjs first`);
		process.exit(1);
	}

	copyFileSync(assetPath, destinationPath);
	chmodSync(destinationPath, 0o755);
}

function copyDirectory(from, to, isExcluded) {
	mkdirSync(to, { recursive: true });

	for (const entry of readdirSync(from, { withFileTypes: true })) {
		if (isExcluded(entry.name)) {
			continue;
		}

		const fromPath = join(from, entry.name);
		const toPath = join(to, entry.name);

		if (entry.isDirectory()) {
			copyDirectory(fromPath, toPath, isExcluded);

			continue;
		}

		copyFileSync(fromPath, toPath);
	}
}

function plainTextOf(markdown) {
	return markdown
		.replaceAll(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replaceAll(/\*\*([^*]+)\*\*/g, "$1")
		.replaceAll(/__([^_]+)__/g, "$1")
		.replaceAll(/\*([^*]+)\*/g, "$1")
		.replaceAll(/(^|[^A-Za-z0-9_])_([^_]+)_(?![A-Za-z0-9_])/g, "$1$2")
		.replaceAll("`", "");
}

function firstSentenceOf(readme) {
	const paragraph = readme
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line.length > 0 && !line.startsWith("#"));

	if (paragraph === undefined) {
		console.error(`no prose found in ${join(repositoryRoot, "README.md")}`);
		process.exit(1);
	}

	const sentence = plainTextOf(paragraph);
	const end = sentence.indexOf(". ");

	return end === -1 ? sentence : sentence.slice(0, end + 1);
}

function packReportsOf(directories) {
	const result = spawnSync(["npm", "pack", "--dry-run", "--json", ...directories].join(" "), {
		cwd: repositoryRoot,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		shell: true,
	});

	if (result.error !== undefined) {
		console.error(result.error.message);
		process.exit(1);
	}

	if (result.status !== 0) {
		console.error(result.stderr);
		process.exit(1);
	}

	try {
		return JSON.parse(result.stdout);
	} catch {
		console.error(`npm pack --dry-run --json printed no report:\n${result.stdout}`);
		process.exit(1);
	}
}

function verifyExecutables(entries) {
	const reports = packReportsOf(
		entries.map((entry) => relative(repositoryRoot, entry.directory).replaceAll("\\", "/")),
	);

	for (const entry of entries) {
		const report = reports.find((candidate) => candidate.name === entry.name);

		if (report === undefined) {
			console.error(`npm pack reported nothing for ${entry.name}`);
			process.exit(1);
		}

		const file = report.files.find((candidate) => candidate.path === entry.executable);

		if (file === undefined) {
			console.error(`${entry.name} packs no ${entry.executable}`);
			process.exit(1);
		}

		const mode = file.mode.toString(8).padStart(4, "0");

		if ((file.mode & 0o111) === 0) {
			console.error(
				`${entry.name} packs ${entry.executable} at mode ${mode} and would install non-executable; name it in the package's bin map`,
			);
			process.exit(1);
		}

		console.log(`${entry.name} packs ${entry.executable} at mode ${mode} in ${String(report.size)} bytes`);
	}
}

rmSync(npmDirectory, { recursive: true, force: true });

const platformPackages = [];

for (const target of targets) {
	const extension = target.os === "win32" ? ".exe" : "";
	const packageName = directoryNameOf(target.name);
	const binaryName = `znpm${extension}`;
	const directory = join(npmDirectory, packageName);
	const libc = target.libc === undefined ? "" : ` ${target.libc}`;

	writeManifest(directory, {
		name: target.name,
		version,
		description: `znpm binaries for ${target.os} ${target.cpu}${libc}`,
		license,
		repository,
		bin: { [packageName]: binaryName },
		preferUnplugged: true,
		os: [target.os],
		cpu: [target.cpu],
		...(target.libc === undefined ? {} : { libc: [target.libc] }),
	});

	copyAsset(join(distDirectory, `znpm-${target.asset}${extension}`), join(directory, binaryName));
	copyAsset(
		join(distDirectory, `npm-wrapper-${target.asset}${extension}`),
		join(directory, `npm-wrapper${extension}`),
	);

	platformPackages.push({ name: target.name, directory, executable: binaryName });
}

const metaDirectory = join(npmDirectory, "znpm");

writeManifest(metaDirectory, {
	name: "@zcross/znpm",
	version,
	description: firstSentenceOf(readFileSync(join(repositoryRoot, "README.md"), "utf8")),
	license,
	repository,
	type: "module",
	bin: { znpm: "bin/znpm.js" },
	engines: { node: ">=18" },
	optionalDependencies: Object.fromEntries(targets.map((target) => [target.name, version])),
});

copyDirectory(join(sourceDirectory, "bin"), join(metaDirectory, "bin"), (name) => name.endsWith(".test.js"));
copyDirectory(join(sourceDirectory, "lib"), join(metaDirectory, "lib"), (name) => name.endsWith(".test.js"));
copyFileSync(join(repositoryRoot, "README.md"), join(metaDirectory, "README.md"));
copyFileSync(join(repositoryRoot, "LICENSE"), join(metaDirectory, "LICENSE"));

verifyExecutables(platformPackages);

console.log(`wrote ${String(targets.length + 1)} packages to ${npmDirectory}`);
