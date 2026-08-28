import { describe, expect, it } from "vitest";
import { batchesByDepthOf } from "./batchesByDepthOf";

describe("batchesByDepthOf", () => {
	it("returns no batches for an empty list", () => {
		expect(batchesByDepthOf([]).size).toBe(0);
	});

	it("groups by node_modules nesting depth and keeps source order inside a depth", () => {
		const parent = { location: "node_modules/parent" };
		const nested = { location: "node_modules/parent/node_modules/child" };
		const sibling = { location: "node_modules/sibling" };
		const scoped = { location: "node_modules/@scope/name" };
		const batches = batchesByDepthOf([parent, nested, sibling, scoped]);

		expect(batches.get(1)).toEqual([parent, sibling, scoped]);
		expect(batches.get(2)).toEqual([nested]);
		expect(batches.size).toBe(2);
	});
});
