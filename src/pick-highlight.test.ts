// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { ZOOM_ATTR } from "./canvas-gestures";
import { mapPoint, mapRect } from "./pick-highlight";
import { SCALE_ATTR } from "./screen-frame";

/** A frame whose ancestors carry the given stamps, with a patched rect. */
function frameWith(stamps: Partial<Record<string, string>>): HTMLIFrameElement {
	document.body.innerHTML = "";
	const zoomLayer = document.createElement("div");
	if (stamps[ZOOM_ATTR] !== undefined) zoomLayer.setAttribute(ZOOM_ATTR, stamps[ZOOM_ATTR]);
	const scaleLayer = document.createElement("div");
	if (stamps[SCALE_ATTR] !== undefined) scaleLayer.setAttribute(SCALE_ATTR, stamps[SCALE_ATTR]);
	const frame = document.createElement("iframe");
	scaleLayer.append(frame);
	zoomLayer.append(scaleLayer);
	document.body.append(zoomLayer);
	frame.getBoundingClientRect = () => ({ top: 50, left: 100, width: 195, height: 422 }) as DOMRect;
	return frame;
}

function pickedElement(): Element {
	const element = document.createElement("button");
	element.getBoundingClientRect = () => ({ top: 20, left: 40, width: 200, height: 60 }) as DOMRect;
	return element;
}

describe("mapRect", () => {
	it("passes a frameless rect through untouched", () => {
		expect(mapRect(pickedElement(), null)).toEqual({ top: 20, left: 40, width: 200, height: 60 });
	});

	it("offsets by the frame with no stamps around it", () => {
		const rect = mapRect(pickedElement(), frameWith({}));
		expect(rect).toEqual({ top: 70, left: 140, width: 200, height: 60 });
	});

	it("applies a stamped scale alone", () => {
		const rect = mapRect(pickedElement(), frameWith({ [SCALE_ATTR]: "0.5" }));
		expect(rect).toEqual({ top: 60, left: 120, width: 100, height: 30 });
	});

	it("applies a stamped canvas zoom alone", () => {
		const rect = mapRect(pickedElement(), frameWith({ [ZOOM_ATTR]: "0.5" }));
		expect(rect).toEqual({ top: 60, left: 120, width: 100, height: 30 });
	});

	it("multiplies scale and zoom when both are stamped", () => {
		// A canvas node stamps scale 1, but the invariant is the PRODUCT — a
		// scaled frame inside a zoomed viewport must compose both.
		const rect = mapRect(pickedElement(), frameWith({ [SCALE_ATTR]: "0.5", [ZOOM_ATTR]: "0.5" }));
		expect(rect).toEqual({ top: 55, left: 110, width: 50, height: 15 });
	});

	it("treats a garbage stamp as 1, never 0 or negative", () => {
		const rect = mapRect(pickedElement(), frameWith({ [SCALE_ATTR]: "banana", [ZOOM_ATTR]: "-2" }));
		expect(rect).toEqual({ top: 70, left: 140, width: 200, height: 60 });
	});
});

describe("mapPoint", () => {
	it("maps an event point with the same composed factor as mapRect", () => {
		const frame = frameWith({ [SCALE_ATTR]: "0.5", [ZOOM_ATTR]: "0.5" });
		expect(mapPoint(40, 20, frame)).toEqual({ x: 110, y: 55 });
	});
});
