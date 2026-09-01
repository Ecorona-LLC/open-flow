import { describe, expect, it } from "vitest";
import { placePopover, sameSpot } from "./floating";

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

describe("sameSpot", () => {
	it("is the bail-out that keeps a placement from re-rendering itself forever", () => {
		// `useFloating` places on every render; without this the fresh object
		// `placePopover` returns is always new state, and the loop crashed a tab.
		expect(sameSpot({ top: 10, left: 20 }, { top: 10, left: 20 })).toBe(true);
		expect(sameSpot({ top: 10, left: 20 }, { top: 10, left: 21 })).toBe(false);
		expect(sameSpot({ top: 10, left: 20 }, { top: 11, left: 20 })).toBe(false);
		// Nothing placed yet is never the same spot — the first paint must run.
		expect(sameSpot(null, { top: 0, left: 0 })).toBe(false);
	});
});
