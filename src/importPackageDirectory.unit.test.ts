import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importPackageDirectory } from "./importPackageDirectory";

describe("importPackageDirectory", () => {
	const roots: Array<string> = [];

	afterEach(() => {
		for (const root of roots.splice(0)) {
			rmSync(root, { recursive: true, force: true, maxRetries: 3 });
		}
	});

	it("hard-links staged files over dest and leaves nested node_modules in place", async () => {
		const root = openRoot();
		const store = join(root, "store");
		const dest = join(root, "package");

		mkdirSync(store);
		writeFileSync(join(store, "package.json"), `${JSON.stringify({ name: "pkg", version: "1.0.0" })}\n`);
		writeFileSync(join(store, "index.js"), "module.exports = 1\n");
		mkdirSync(join(dest, "node_modules", "nested"), { recursive: true });
		writeFileSync(join(dest, "package.json"), `${JSON.stringify({ name: "pkg", version: "1.0.0" })}\n`);
		writeFileSync(join(dest, "index.js"), "module.exports = 0\n");
		writeFileSync(join(dest, "node_modules", "nested", "keep.txt"), "nested\n");

		await expect(
			importPackageDirectory(dest, {
				"package.json": join(store, "package.json"),
				"index.js": join(store, "index.js"),
			}),
		).resolves.toBe("imported");

		expect(statSync(join(dest, "package.json")).ino).toBe(statSync(join(store, "package.json")).ino);
		expect(statSync(join(dest, "index.js")).ino).toBe(statSync(join(store, "index.js")).ino);
		expect(statSync(join(dest, "package.json")).nlink).toBeGreaterThan(1);
		expect(readFileSync(join(dest, "node_modules", "nested", "keep.txt"), "utf8")).toBe("nested\n");
		expect(siblingTempsOf(root, "package")).toEqual([]);
	});

	it("links bundled node_modules from the files map and keeps extra nested packages", async () => {
		const root = openRoot();
		const store = join(root, "store");
		const dest = join(root, "package");

		mkdirSync(join(store, "node_modules", "bundled"), { recursive: true });
		writeFileSync(join(store, "package.json"), `${JSON.stringify({ name: "parent", version: "1.0.0" })}\n`);
		writeFileSync(join(store, "node_modules", "bundled", "package.json"), `${JSON.stringify({ name: "bundled" })}\n`);
		mkdirSync(join(dest, "node_modules", "bundled"), { recursive: true });
		mkdirSync(join(dest, "node_modules", "extra"), { recursive: true });
		writeFileSync(join(dest, "package.json"), `${JSON.stringify({ name: "parent", version: "1.0.0" })}\n`);
		writeFileSync(join(dest, "node_modules", "bundled", "package.json"), `${JSON.stringify({ name: "bundled" })}\n`);
		writeFileSync(join(dest, "node_modules", "extra", "keep.txt"), "extra\n");

		await expect(
			importPackageDirectory(dest, {
				"package.json": join(store, "package.json"),
				"node_modules/bundled/package.json": join(store, "node_modules", "bundled", "package.json"),
			}),
		).resolves.toBe("imported");

		expect(statSync(join(dest, "package.json")).ino).toBe(statSync(join(store, "package.json")).ino);
		expect(statSync(join(dest, "node_modules", "bundled", "package.json")).ino).toBe(
			statSync(join(store, "node_modules", "bundled", "package.json")).ino,
		);
		expect(readFileSync(join(dest, "node_modules", "extra", "keep.txt"), "utf8")).toBe("extra\n");
	});

	it("returns locked and leaves dest when dest cannot be moved aside", async () => {
		const root = openRoot();
		const store = join(root, "store");
		const dest = join(root, "missing", "package");

		mkdirSync(store);
		writeFileSync(join(store, "package.json"), "{}\n");

		await expect(importPackageDirectory(dest, { "package.json": join(store, "package.json") })).resolves.toBe(
			"locked",
		);
		expect(existsSync(dest)).toBe(false);
		expect(siblingTempsOf(join(root, "missing"), "package")).toEqual([]);
	});

	it("throws on a missing store file and leaves dest untouched", async () => {
		const root = openRoot();
		const dest = join(root, "package");

		mkdirSync(dest);
		writeFileSync(join(dest, "package.json"), `${JSON.stringify({ name: "pkg", version: "1.0.0" })}\n`);

		await expect(importPackageDirectory(dest, { "package.json": join(root, "absent") })).rejects.toMatchObject({
			code: "ENOENT",
		});
		expect(readFileSync(join(dest, "package.json"), "utf8")).toBe(
			`${JSON.stringify({ name: "pkg", version: "1.0.0" })}\n`,
		);
		expect(siblingTempsOf(root, "package")).toEqual([]);
	});

	function openRoot(): string {
		const root = mkdtempSync(join(tmpdir(), "znpm-import-"));

		roots.push(root);

		return root;
	}
});

function siblingTempsOf(directory: string, packageName: string): Array<string> {
	return readdirSync(directory).filter(
		(name) => name.startsWith(`${packageName}.`) && (name.includes("znpm-stage") || name.includes("znpm-aside")),
	);
}
