import { describe, expect, it } from "vitest";
import { placePopover } from "./connect-popover";

const SIZE = { width: 256, height: 90 };
const VIEWPORT = { width: 1280, height: 800 };

describe("placePopover", () => {
	it("sits below the control by default", () => {
		const at = placePopover({ top: 100, left: 200, width: 80, height: 30 }, SIZE, VIEWPORT);
		expect(at).toEqual({ top: 136, left: 200 });
	});

	it("flips above when the bottom would leave the viewport", () => {
		const at = placePopover({ top: 760, left: 200, width: 80, height: 30 }, SIZE, VIEWPORT);
		expect(at.top).toBe(760 - SIZE.height - 6);
	});

	it("clamps to the viewport edges rather than overflowing", () => {
		const right = placePopover({ top: 100, left: 1250, width: 80, height: 30 }, SIZE, VIEWPORT);
		expect(right.left).toBe(1280 - SIZE.width - 8);
		const left = placePopover({ top: 100, left: -20, width: 80, height: 30 }, SIZE, VIEWPORT);
		expect(left.left).toBe(8);
		// A control near the top of a short viewport: never above 8px.
		const cramped = placePopover({ top: 10, left: 0, width: 10, height: 10 }, SIZE, {
			width: 300,
			height: 100,
		});
		expect(cramped.top).toBe(8);
	});
});
