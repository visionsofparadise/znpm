import { describe, expect, it } from "vitest";
import { isTreeMutatingNpmCommand } from "./isTreeMutatingNpmCommand";

describe("isTreeMutatingNpmCommand", () => {
	it("accepts install and its aliases", () => {
		expect(isTreeMutatingNpmCommand(["install"], {})).toBe(true);
		expect(isTreeMutatingNpmCommand(["i", "left-pad"], {})).toBe(true);
		expect(isTreeMutatingNpmCommand(["add", "left-pad"], {})).toBe(true);
		expect(isTreeMutatingNpmCommand(["ci"], {})).toBe(true);
		expect(isTreeMutatingNpmCommand(["uninstall", "left-pad"], {})).toBe(true);
		expect(isTreeMutatingNpmCommand(["update"], {})).toBe(true);
		expect(isTreeMutatingNpmCommand(["dedupe"], {})).toBe(true);
		expect(isTreeMutatingNpmCommand(["prune"], {})).toBe(true);
		expect(isTreeMutatingNpmCommand(["rebuild"], {})).toBe(true);
		expect(isTreeMutatingNpmCommand(["link"], {})).toBe(true);
		expect(isTreeMutatingNpmCommand(["it"], {})).toBe(true);
		expect(isTreeMutatingNpmCommand(["cit"], {})).toBe(true);
	});

	it("finds the command after value-taking flags", () => {
		expect(isTreeMutatingNpmCommand(["--prefix", "app", "install"], {})).toBe(true);
		expect(isTreeMutatingNpmCommand(["-C", "app", "i"], {})).toBe(true);
		expect(isTreeMutatingNpmCommand(["--loglevel", "silent", "ci"], {})).toBe(true);
	});

	it("rejects run, test, and other non-mutating commands", () => {
		expect(isTreeMutatingNpmCommand(["run", "hello"], {})).toBe(false);
		expect(isTreeMutatingNpmCommand(["test"], {})).toBe(false);
		expect(isTreeMutatingNpmCommand(["ls"], {})).toBe(false);
		expect(isTreeMutatingNpmCommand(["--version"], {})).toBe(false);
		expect(isTreeMutatingNpmCommand(["view", "left-pad"], {})).toBe(false);
		expect(isTreeMutatingNpmCommand(["exec", "cowsay"], {})).toBe(false);
		expect(isTreeMutatingNpmCommand(["find-dupes"], {})).toBe(false);
		expect(isTreeMutatingNpmCommand(["audit"], {})).toBe(false);
		expect(isTreeMutatingNpmCommand(["audit", "signatures"], {})).toBe(false);
		expect(isTreeMutatingNpmCommand([], {})).toBe(false);
	});

	it("accepts audit fix", () => {
		expect(isTreeMutatingNpmCommand(["audit", "fix"], {})).toBe(true);
		expect(isTreeMutatingNpmCommand(["--prefix", "app", "audit", "fix"], {})).toBe(true);
	});

	it("rejects global installs", () => {
		expect(isTreeMutatingNpmCommand(["install", "-g", "cowsay"], {})).toBe(false);
		expect(isTreeMutatingNpmCommand(["-g", "install", "cowsay"], {})).toBe(false);
		expect(isTreeMutatingNpmCommand(["install", "--global", "cowsay"], {})).toBe(false);
		expect(isTreeMutatingNpmCommand(["install", "--location=global", "cowsay"], {})).toBe(false);
		expect(isTreeMutatingNpmCommand(["install"], { npm_config_global: "true" })).toBe(false);
	});

	it("rejects dry-run and help", () => {
		expect(isTreeMutatingNpmCommand(["install", "--dry-run"], {})).toBe(false);
		expect(isTreeMutatingNpmCommand(["install", "--help"], {})).toBe(false);
		expect(isTreeMutatingNpmCommand(["install", "-h"], {})).toBe(false);
	});
});
