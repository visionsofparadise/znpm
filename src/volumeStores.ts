import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pnpmHomeDirectoryOf } from "./pnpmHome";

const windowsDriveLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function volumeStoreDirectoriesOf(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): Array<string> {
	const directories: Array<string> = [];
	const seen = new Set<string>();

	for (const base of storeBasesOf(env, platform)) {
		for (const directory of versionDirectoriesOf(base)) {
			const key = identityKeyOf(directory);

			if (seen.has(key)) {
				continue;
			}

			seen.add(key);
			directories.push(directory);
		}
	}

	return directories;
}

function storeBasesOf(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): Array<string> {
	return [join(pnpmHomeDirectoryOf(env, platform), "store"), ...volumeStoreBasesOf(platform)];
}

function volumeStoreBasesOf(platform: NodeJS.Platform): Array<string> {
	if (platform === "win32") {
		return windowsVolumeStoreBasesOf();
	}

	if (platform === "darwin") {
		return darwinVolumeStoreBasesOf();
	}

	return linuxVolumeStoreBasesOf();
}

function windowsVolumeStoreBasesOf(): Array<string> {
	const bases: Array<string> = [];

	for (const letter of windowsDriveLetters) {
		const root = `${letter}:\\`;

		if (!existsSync(root)) {
			continue;
		}

		const base = join(root, ".pnpm-store");

		if (existsSync(base)) {
			bases.push(base);
		}
	}

	return bases;
}

function darwinVolumeStoreBasesOf(): Array<string> {
	return volumeStoreBasesUnderOf("/Volumes");
}

function volumeStoreBasesUnderOf(volumesDirectory: string): Array<string> {
	if (!existsSync(volumesDirectory)) {
		return [];
	}

	let names: Array<string>;

	try {
		names = readdirSync(volumesDirectory);
	} catch {
		return [];
	}

	const bases: Array<string> = [];

	for (const name of names) {
		const base = join(volumesDirectory, name, ".pnpm-store");

		if (existsSync(base)) {
			bases.push(base);
		}
	}

	return bases;
}

function linuxVolumeStoreBasesOf(): Array<string> {
	const bases: Array<string> = [];

	for (const mountpoint of localRwMountpointsOf()) {
		const base = join(mountpoint, ".pnpm-store");

		if (existsSync(base)) {
			bases.push(base);
		}
	}

	return bases;
}

function localRwMountpointsOf(): Array<string> {
	let content: string;

	try {
		content = readFileSync("/proc/mounts", "utf8");
	} catch {
		return [];
	}

	const mountpoints: Array<string> = [];

	for (const line of content.split("\n")) {
		const mountpoint = localRwMountpointOf(line);

		if (mountpoint !== undefined) {
			mountpoints.push(mountpoint);
		}
	}

	return mountpoints;
}

function localRwMountpointOf(line: string): string | undefined {
	if (line === "") {
		return undefined;
	}

	const fields = line.split(" ");
	const mountpoint = fields[1];
	const filesystemType = fields[2];
	const options = fields[3];

	if (mountpoint === undefined || filesystemType === undefined || options === undefined) {
		return undefined;
	}

	if (!options.split(",").includes("rw")) {
		return undefined;
	}

	if (isRemoteFilesystem(filesystemType)) {
		return undefined;
	}

	return unescapedProcMountFieldOf(mountpoint);
}

function isRemoteFilesystem(filesystemType: string): boolean {
	if (filesystemType.startsWith("fuse")) {
		return true;
	}

	return (
		filesystemType === "nfs" ||
		filesystemType === "nfs4" ||
		filesystemType === "cifs" ||
		filesystemType === "smb3" ||
		filesystemType === "smbfs" ||
		filesystemType === "ncpfs" ||
		filesystemType === "9p" ||
		filesystemType === "afs" ||
		filesystemType === "ceph" ||
		filesystemType === "glusterfs"
	);
}

function unescapedProcMountFieldOf(value: string): string {
	return value.replaceAll(/\\([0-7]{3})/g, (_match, octal: string) => String.fromCodePoint(Number.parseInt(octal, 8)));
}

function versionDirectoriesOf(storeBase: string): Array<string> {
	if (!existsSync(storeBase)) {
		return [];
	}

	try {
		return readdirSync(storeBase, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && /^v\d+$/.test(entry.name))
			.map((entry) => join(storeBase, entry.name));
	} catch {
		return [];
	}
}

function identityKeyOf(path: string): string {
	return process.platform === "win32" ? path.toLowerCase() : path;
}
