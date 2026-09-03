import { describe, expect, it } from "vitest";
import { npmReportLevelOf } from "./npmReportLevelOf";

describe("npmReportLevelOf", () => {
	it("returns silent for each silent flag form", () => {
		expect(npmReportLevelOf(["install", "--json"], {})).toBe("silent");
		expect(npmReportLevelOf(["install", "--json=true"], {})).toBe("silent");
		expect(npmReportLevelOf(["install", "--silent"], {})).toBe("silent");
		expect(npmReportLevelOf(["install", "-s"], {})).toBe("silent");
		expect(npmReportLevelOf(["install", "--loglevel", "silent"], {})).toBe("silent");
		expect(npmReportLevelOf(["install", "--loglevel=silent"], {})).toBe("silent");
		expect(npmReportLevelOf(["install", "--loglevel", "error"], {})).toBe("silent");
		expect(npmReportLevelOf(["install", "--loglevel=error"], {})).toBe("silent");
	});

	it("returns verbose for each verbose flag form", () => {
		expect(npmReportLevelOf(["install", "--verbose"], {})).toBe("verbose");
		expect(npmReportLevelOf(["install", "-dd"], {})).toBe("verbose");
		expect(npmReportLevelOf(["install", "-ddd"], {})).toBe("verbose");
		expect(npmReportLevelOf(["install", "--loglevel", "verbose"], {})).toBe("verbose");
		expect(npmReportLevelOf(["install", "--loglevel=verbose"], {})).toBe("verbose");
		expect(npmReportLevelOf(["install", "--loglevel", "silly"], {})).toBe("verbose");
		expect(npmReportLevelOf(["install", "--loglevel=silly"], {})).toBe("verbose");
	});

	it("returns silent or verbose from env when no report flag is present", () => {
		expect(npmReportLevelOf(["install"], { npm_config_json: "true" })).toBe("silent");
		expect(npmReportLevelOf(["install"], { npm_config_json: "1" })).toBe("silent");
		expect(npmReportLevelOf(["install"], { npm_config_loglevel: "silent" })).toBe("silent");
		expect(npmReportLevelOf(["install"], { npm_config_loglevel: "error" })).toBe("silent");
		expect(npmReportLevelOf(["install"], { npm_config_loglevel: "verbose" })).toBe("verbose");
		expect(npmReportLevelOf(["install"], { npm_config_loglevel: "silly" })).toBe("verbose");
	});

	it("lets a flag outrank env", () => {
		expect(npmReportLevelOf(["install", "--verbose"], { npm_config_json: "true" })).toBe("verbose");
		expect(npmReportLevelOf(["install", "--json"], { npm_config_loglevel: "verbose" })).toBe("silent");
	});

	it("stops parsing at --", () => {
		expect(npmReportLevelOf(["install", "--", "--json"], {})).toBe("line");
		expect(npmReportLevelOf(["install", "--", "--verbose"], {})).toBe("line");
	});

	it("returns line when no silent or verbose marker is present", () => {
		expect(npmReportLevelOf(["install"], {})).toBe("line");
	});
});
