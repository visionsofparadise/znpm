import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readHiddenLockfile, candidatePackagesOf, type Resolution } from "./hiddenLockfile";

describe("readHiddenLockfile", () => {
	it("returns undefined when the hidden lockfile is absent", () => {
		expect(readHiddenLockfile(join("Z:", "no-such-znpm-project"))).toBeUndefined();
	});
});

describe("candidatePackagesOf", () => {
	it("takes the name from an aliased entry rather than the path", () => {
		const { candidatePackages, notATarball } = candidatePackagesOf({
			packages: {
				"node_modules/foo": {
					name: "bar",
					version: "1.0.0",
					resolved: "https://registry.npmjs.org/bar/-/bar-2.3.4.tgz",
					integrity: "sha512-abc",
				},
			},
		});

		expect(notATarball).toBe(0);
		expect(candidatePackages).toEqual([
			{
				location: "node_modules/foo",
				name: "bar",
				version: "2.3.4",
				resolution: {
					tarball: "https://registry.npmjs.org/bar/-/bar-2.3.4.tgz",
					integrity: "sha512-abc",
				},
			},
		]);
	});

	it("anchors the version on the bare package name so babel-walk-3.0.0-canary-5 is not version 5", () => {
		const { candidatePackages } = candidatePackagesOf({
			packages: {
				"node_modules/babel-walk": {
					version: "3.0.0-canary-5",
					resolved: "https://registry.npmjs.org/babel-walk/-/babel-walk-3.0.0-canary-5.tgz",
					integrity: "sha512-abc",
				},
			},
		});

		expect(candidatePackages[0]?.name).toBe("babel-walk");
		expect(candidatePackages[0]?.version).toBe("3.0.0-canary-5");
	});

	it("takes the version from resolved over the lockfile entry", () => {
		const { candidatePackages } = candidatePackagesOf({
			packages: {
				"node_modules/micromark-extension-gfm": {
					version: "0.4.0",
					resolved: "https://registry.npmjs.org/micromark-extension-gfm/-/micromark-extension-gfm-0.3.3.tgz",
					integrity: "sha512-abc",
				},
			},
		});

		expect(candidatePackages[0]?.version).toBe("0.3.3");
	});

	it("normalizes git+ssh GitHub URLs to https", () => {
		const { candidatePackages, notATarball } = candidatePackagesOf({
			packages: {
				"node_modules/some-git-dep": {
					version: "1.0.0",
					resolved: "git+ssh://git@github.com/user/repo.git#abcdef",
				},
			},
		});

		const resolution: Resolution = {
			type: "git",
			repo: "https://github.com/user/repo.git",
			commit: "abcdef",
		};

		expect(notATarball).toBe(0);
		expect(candidatePackages).toEqual([
			{
				location: "node_modules/some-git-dep",
				name: "some-git-dep",
				version: "1.0.0",
				resolution,
			},
		]);
	});

	it("skips link: true and bundled entries that carry no resolved", () => {
		const { candidatePackages, notATarball } = candidatePackagesOf({
			packages: {
				"node_modules/local": {
					link: true,
					resolved: "file:../local",
				},
				"node_modules/parent/node_modules/bundled-child": {
					version: "1.0.0",
					inBundle: true,
				},
			},
		});

		expect(candidatePackages).toEqual([]);
		expect(notATarball).toBe(2);
	});
});
