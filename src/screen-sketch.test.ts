import { describe, expect, it } from "vitest";
import { sketchOf, SKETCH_MAX_BOXES, type SketchInput } from "./screen-sketch";

const VIEWPORT = { width: 400, height: 800 };

function box(over: Partial<SketchInput> = {}): SketchInput {
	return { tag: "DIV", x: 0, y: 0, w: 200, h: 200, text: false, ...over };
}

describe("sketchOf", () => {
	it("normalises every box against the viewport it was measured in", () => {
		const { boxes, width, height } = sketchOf(VIEWPORT, [box({ x: 100, y: 200, w: 200, h: 400 })]);
		expect(width).toBe(400);
		expect(height).toBe(800);
		expect(boxes[0]).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5, kind: "surface" });
	});

	it("keeps the biggest boxes, because the layout IS the big boxes", () => {
		const inputs = [box({ w: 40, h: 40 }), box({ w: 400, h: 300 }), box({ w: 200, h: 100 })];
		const { boxes } = sketchOf(VIEWPORT, inputs);
		const areas = boxes.map((b) => Math.round(b.w * b.h * 400 * 800));
		expect(areas).toEqual([120_000, 20_000, 1_600]);
	});

	it("caps the count — past forty it reads as noise, not as a page", () => {
		const many = Array.from({ length: 200 }, (_, index) => box({ w: 300 - index, h: 300 }));
		expect(sketchOf(VIEWPORT, many).boxes).toHaveLength(SKETCH_MAX_BOXES);
		expect(sketchOf(VIEWPORT, many, 5).boxes).toHaveLength(5);
	});

	it("drops what the frame does not show", () => {
		const inputs = [
			box({ x: 400, y: 0 }), // starts past the right edge
			box({ x: 0, y: 800 }), // starts below the fold
			box({ x: -300, y: 0, w: 200 }), // ends before the left edge
			box({ w: 0, h: 100 }), // no area
			box({ x: 10, y: 10, w: 100, h: 100 }), // the only real one
		];
		const { boxes } = sketchOf(VIEWPORT, inputs);
		expect(boxes).toHaveLength(1);
		expect(boxes[0]?.x).toBeCloseTo(0.025);
	});

	it("keeps a small heading but drops the small div around it", () => {
		// A heading is small and says more than its wrapper — so text clears a
		// lower bar than a surface does.
		const small = { x: 0, y: 0, w: 40, h: 16 };
		const heading = sketchOf(VIEWPORT, [box({ ...small, tag: "H1", text: true })]);
		const wrapper = sketchOf(VIEWPORT, [box({ ...small, tag: "DIV" })]);
		expect(heading.boxes).toHaveLength(1);
		expect(heading.boxes[0]?.kind).toBe("text");
		expect(wrapper.boxes).toHaveLength(0);
	});

	it("calls an image media even when it carries no text", () => {
		const { boxes } = sketchOf(VIEWPORT, [box({ tag: "IMG" })]);
		expect(boxes[0]?.kind).toBe("media");
	});

	it("only calls it text when the element owns the words", () => {
		// A <span> that merely wraps another element is structure, not a line.
		expect(sketchOf(VIEWPORT, [box({ tag: "SPAN", text: false })]).boxes[0]?.kind).toBe("surface");
		expect(sketchOf(VIEWPORT, [box({ tag: "SPAN", text: true })]).boxes[0]?.kind).toBe("text");
	});

	it("clamps a box that runs past the edges instead of drawing outside", () => {
		const { boxes } = sketchOf(VIEWPORT, [box({ x: -50, y: -50, w: 600, h: 1000 })]);
		expect(boxes[0]).toEqual({ x: 0, y: 0, w: 1, h: 1, kind: "surface" });
	});

	it("draws one rectangle once, however many wrappers share it", () => {
		// `body > #__next > div > div > main` all measure the same box; kept,
		// they spend five of forty slots on one shape drawn five times.
		const stack = Array.from({ length: 5 }, () => box({ w: 400, h: 600 }));
		const { boxes } = sketchOf(VIEWPORT, [...stack, box({ x: 0, y: 620, w: 380, h: 100 })]);
		expect(boxes).toHaveLength(2);
	});

	it("keeps boxes that merely overlap, since that is real structure", () => {
		// A sidebar inside a shell is not a duplicate of the shell.
		const { boxes } = sketchOf(VIEWPORT, [
			box({ w: 400, h: 600 }),
			box({ x: 0, y: 0, w: 120, h: 600 }),
		]);
		expect(boxes).toHaveLength(2);
	});

	it("survives an empty document and a zero viewport", () => {
		expect(sketchOf(VIEWPORT, []).boxes).toEqual([]);
		expect(sketchOf({ width: 0, height: 0 }, [box()]).boxes).toEqual([]);
	});
});
