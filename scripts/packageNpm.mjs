#!/usr/bin/env node
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
import { join } from "node:path";
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

function firstSentenceOf(readme) {
	const paragraph = readme
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line.length > 0 && !line.startsWith("#"));

	if (paragraph === undefined) {
		console.error(`no prose found in ${join(repositoryRoot, "README.md")}`);
		process.exit(1);
	}

	const end = paragraph.indexOf(". ");

	return end === -1 ? paragraph : paragraph.slice(0, end + 1);
}

rmSync(npmDirectory, { recursive: true, force: true });

for (const target of targets) {
	const extension = target.os === "win32" ? ".exe" : "";
	const directory = join(npmDirectory, directoryNameOf(target.name));
	const libc = target.libc === undefined ? "" : ` ${target.libc}`;

	writeManifest(directory, {
		name: target.name,
		version,
		description: `znpm binaries for ${target.os} ${target.cpu}${libc}`,
		license,
		repository,
		preferUnplugged: true,
		os: [target.os],
		cpu: [target.cpu],
		...(target.libc === undefined ? {} : { libc: [target.libc] }),
	});

	copyAsset(join(distDirectory, `znpm-${target.asset}${extension}`), join(directory, `znpm${extension}`));
	copyAsset(
		join(distDirectory, `npm-wrapper-${target.asset}${extension}`),
		join(directory, `npm-wrapper${extension}`),
	);
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

copyDirectory(join(sourceDirectory, "bin"), join(metaDirectory, "bin"), () => false);
copyDirectory(join(sourceDirectory, "lib"), join(metaDirectory, "lib"), (name) => name.endsWith(".test.js"));
copyFileSync(join(repositoryRoot, "README.md"), join(metaDirectory, "README.md"));
copyFileSync(join(repositoryRoot, "LICENSE"), join(metaDirectory, "LICENSE"));

console.log(`wrote ${String(targets.length + 1)} packages to ${npmDirectory}`);
