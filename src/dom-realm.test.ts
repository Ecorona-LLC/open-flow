// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { isElement, readProp } from "./dom-realm";

describe("isElement", () => {
	it("recognises an element from another realm where instanceof cannot", () => {
		// The bug this module exists for: every flow frame document has its own
		// constructors, so `value instanceof Element` is false for its nodes.
		// This is the test that would have caught the error listener reading
		// `event instanceof ErrorEvent` across that boundary.
		const frame = document.createElement("iframe");
		document.body.appendChild(frame);
		const doc = frame.contentDocument;
		if (!doc) throw new Error("happy-dom sin contentDocument");
		const foreign = doc.createElement("button");
		doc.body?.appendChild(foreign);

		expect(isElement(foreign)).toBe(true);
		expect(isElement(doc)).toBe(false);
		expect(isElement(null)).toBe(false);
		expect(isElement("button")).toBe(false);
	});
});

describe("readProp", () => {
	it("reads from objects and functions alike", () => {
		// A plain function component's name lives on the function itself;
		// restricting to objects made Button resolve and LandingHero never.
		function LandingHero() {}
		expect(readProp(LandingHero, "name")).toBe("LandingHero");
		expect(readProp({ tagName: "A" }, "tagName")).toBe("A");
		expect(readProp(null, "x")).toBeUndefined();
	});

	it("a throwing getter answers undefined instead of taking the handler down", () => {
		const trap = {};
		Object.defineProperty(trap, "explota", {
			get() {
				throw new Error("boom");
			},
		});
		expect(readProp(trap, "explota")).toBeUndefined();
	});
});
