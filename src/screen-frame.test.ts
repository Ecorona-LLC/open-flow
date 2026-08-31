import { describe, expect, it } from "vitest";
import { FRAME_CHROME, fitRows, fitScale, rowExtent, rowWidth, STEP_GUTTER } from "./screen-frame";

describe("fitScale", () => {
	it("never exceeds natural size", () => {
		expect(fitScale(5000, 1000, 0)).toBe(1);
	});

	it("floors at the minimum scale instead of vanishing", () => {
		expect(fitScale(200, 10_000, 0)).toBeCloseTo(0.15);
		// A container narrower than the gutters has no usable width at all.
		expect(fitScale(40, 1000, 100)).toBeCloseTo(0.15);
	});

	it("subtracts the gutters from the available width, not from the frames", () => {
		// naturalWidth is a SUM of possibly-different frame widths; the scale
		// applies to the frames only, so gutters come off the container side.
		const scale = fitScale(1058, 2000, 50);
		expect(scale).toBeCloseTo((1058 - 50 - 8) / 2000);
	});

	it("an empty board fits by definition", () => {
		expect(fitScale(0, 0, 0)).toBe(1);
	});
});

describe("rowExtent and rowWidth", () => {
	it("agree at scale 1: what fit was solved for is what the row draws", () => {
		const widths = [390, 1440];
		const extent = rowExtent(widths);
		expect(extent).toEqual({ natural: 1830, gutters: 2 * FRAME_CHROME + STEP_GUTTER });
		expect(rowWidth(widths, 1)).toBe(extent.natural + extent.gutters);
		expect(rowExtent([])).toEqual({ natural: 0, gutters: 0 });
	});
});

describe("fitRows", () => {
	it("fits the row that needs the smallest scale, not the widest at 100%", () => {
		// Six phones beside a branch of one phone and two desktops: the branch
		// is wider at 100% (3442 vs 2734), but gutters do not scale and they
		// are a bigger share of the trunk, so the trunk needs the smaller
		// scale. Fitting the branch left the trunk 4px over a 900px board.
		const phones = [390, 390, 390, 390, 390, 390];
		const trunk = rowExtent(phones);
		const branch = rowExtent([390, 1440, 1440]);
		expect(trunk.natural + trunk.gutters).toBeLessThan(branch.natural + branch.gutters);

		const branchOnly = fitScale(900, branch.natural, branch.gutters);
		expect(rowWidth(phones, branchOnly)).toBeGreaterThan(900);

		const scale = fitRows(900, [trunk, branch]);
		expect(scale).toBe(fitScale(900, trunk.natural, trunk.gutters));
		expect(rowWidth(phones, scale)).toBeLessThanOrEqual(900);
		expect(rowWidth([390, 1440, 1440], scale)).toBeLessThanOrEqual(900);
	});

	it("an empty board fits by definition", () => {
		expect(fitRows(0, [])).toBe(1);
	});
});
