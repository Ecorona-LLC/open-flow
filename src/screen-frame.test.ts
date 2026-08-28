import { describe, expect, it } from "vitest";
import { fitScale } from "./screen-frame";

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
