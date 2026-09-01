import { describe, expect, it } from "vitest";
import { detailAt, DETAIL_IN, DETAIL_OUT } from "./canvas-gestures";
import {
	edgeLabelPoint,
	openViewport,
	OPEN_ZOOM,
	edgePath,
	fitViewport,
	MAX_ZOOM,
	MIN_ZOOM,
	revealViewport,
	wheelZoomFactor,
	zoomAt,
} from "./flow-canvas";

const HOST = { width: 1000, height: 600 };

describe("zoomAt", () => {
	it("keeps the world point under the cursor under the cursor", () => {
		const viewport = { tx: 120, ty: -40, z: 0.5 };
		const cursor = { x: 300, y: 200 };
		const world = {
			x: (cursor.x - viewport.tx) / viewport.z,
			y: (cursor.y - viewport.ty) / viewport.z,
		};
		const zoomed = zoomAt(viewport, cursor.x, cursor.y, 1.25);
		expect((cursor.x - zoomed.tx) / zoomed.z).toBeCloseTo(world.x);
		expect((cursor.y - zoomed.ty) / zoomed.z).toBeCloseTo(world.y);
	});

	it("clamps to the zoom bounds and returns the SAME viewport at a wall", () => {
		const atMax = { tx: 0, ty: 0, z: MAX_ZOOM };
		expect(zoomAt(atMax, 100, 100, 2)).toBe(atMax);
		const atMin = { tx: 0, ty: 0, z: MIN_ZOOM };
		expect(zoomAt(atMin, 100, 100, 0.5)).toBe(atMin);
	});

	it("lets a viewport already under the floor zoom OUT no further, but still in", () => {
		// A fit of a very long flow legitimately lands below MIN_ZOOM.
		// Clamping up from there would make "alejar" jump IN.
		const below = { tx: 0, ty: 0, z: 0.06 };
		expect(zoomAt(below, 100, 100, 0.5)).toBe(below);
		expect(zoomAt(below, 100, 100, 2).z).toBeCloseTo(0.12);
	});
});

describe("wheelZoomFactor", () => {
	it("is exponential — equal travel, equal ratio, both directions", () => {
		expect(wheelZoomFactor(100) * wheelZoomFactor(-100)).toBeCloseTo(1);
		expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
	});

	it("treats Firefox line deltas as ~16px lines, and page deltas as pages", () => {
		expect(wheelZoomFactor(3, 1)).toBeCloseTo(wheelZoomFactor(48, 0));
		expect(wheelZoomFactor(1, 2)).toBeCloseTo(wheelZoomFactor(160, 0));
	});
});

describe("fitViewport", () => {
	it("centers a small graph at 1:1, never enlarging past natural size", () => {
		const fitted = fitViewport(HOST, { minX: 0, minY: 0, maxX: 400, maxY: 200 });
		expect(fitted.z).toBe(1);
		expect(fitted.tx).toBe((HOST.width - 400) / 2);
		expect(fitted.ty).toBe((HOST.height - 200) / 2);
	});

	it("shrinks a large graph to the tighter axis, padding kept clear", () => {
		const fitted = fitViewport(HOST, { minX: 0, minY: 0, maxX: 4000, maxY: 1000 });
		// Width wants (1000-96)/4000 = 0.226; height wants (600-96)/1000 = 0.504.
		expect(fitted.z).toBeCloseTo(904 / 4000);
		// Centered: the graph's mapped left edge mirrors its right edge.
		expect(fitted.tx).toBeCloseTo((HOST.width - 4000 * fitted.z) / 2);
	});

	it("respects a bbox that does not start at the origin", () => {
		const fitted = fitViewport(HOST, { minX: -100, minY: 50, maxX: 300, maxY: 250 });
		expect(fitted.tx + -100 * fitted.z).toBe((HOST.width - 400) / 2);
		expect(fitted.ty + 50 * fitted.z).toBe((HOST.height - 200) / 2);
	});

	it("shows the WHOLE graph even when that needs a zoom below the gesture floor", () => {
		// The floor exists for wheel and buttons. A fit that stopped at it
		// would clip a long flow while claiming to have fitted it.
		const long = { minX: 0, minY: 0, maxX: 40_000, maxY: 2_000 };
		const fitted = fitViewport(HOST, long);
		expect(fitted.z).toBeLessThan(MIN_ZOOM);
		expect(fitted.tx + long.maxX * fitted.z).toBeLessThanOrEqual(HOST.width);
		expect(fitted.tx).toBeGreaterThanOrEqual(0);
	});

	it("survives an empty bbox", () => {
		const fitted = fitViewport(HOST, { minX: 0, minY: 0, maxX: 0, maxY: 0 });
		expect(fitted.z).toBe(1);
		expect(Number.isFinite(fitted.tx)).toBe(true);
	});
});

describe("revealViewport", () => {
	const viewport = { tx: 0, ty: 0, z: 0.5 };

	it("does not move when the box is already visible", () => {
		const result = revealViewport(viewport, HOST, { x: 200, y: 200, width: 400, height: 400 });
		expect(result).toBe(viewport);
	});

	it("pans the smallest delta per axis, and never re-zooms", () => {
		// Box maps to [1100, 1300] × [100, 200] — off the right edge by 348.
		const result = revealViewport(viewport, HOST, { x: 2200, y: 200, width: 400, height: 200 });
		expect(result.z).toBe(viewport.z);
		expect(result.tx).toBe(HOST.width - 48 - 1300);
		expect(result.ty).toBe(0);
	});

	it("aligns an oversized box to the padded top-left", () => {
		const result = revealViewport(viewport, HOST, { x: -400, y: 0, width: 4000, height: 200 });
		expect(result.tx + -400 * viewport.z).toBe(48);
	});
});

describe("edge geometry", () => {
	it("bends through the horizontal midpoint", () => {
		expect(edgePath({ x: 0, y: 10 }, { x: 100, y: 90 })).toBe("M 0,10 C 50,10 50,90 100,90");
	});

	it("puts the label exactly mid-curve", () => {
		expect(edgeLabelPoint({ x: 0, y: 10 }, { x: 100, y: 90 })).toEqual({ x: 50, y: 50 });
	});
});

describe("detailAt", () => {
	it("holds its ground inside the dead band, from either side", () => {
		// The whole reason chrome does not thrash on a real pinch: between the
		// two thresholds the answer is "whatever you already were".
		const between = (DETAIL_IN + DETAIL_OUT) / 2;
		expect(detailAt(between, "near")).toBe("near");
		expect(detailAt(between, "far")).toBe("far");
	});

	it("switches only once each threshold is actually crossed", () => {
		expect(detailAt(DETAIL_IN, "far")).toBe("near");
		expect(detailAt(DETAIL_OUT, "near")).toBe("far");
		expect(detailAt(2, "far")).toBe("near");
		expect(detailAt(0.05, "near")).toBe("far");
	});

	it("is idempotent, so the functional setState bails instead of re-rendering", () => {
		for (const z of [0.1, DETAIL_OUT, 0.5, DETAIL_IN, 1]) {
			for (const previous of ["far", "near"] as const) {
				expect(detailAt(z, detailAt(z, previous))).toBe(detailAt(z, previous));
			}
		}
	});
});

describe("routed edges", () => {
	const from = { x: 0, y: 0 };
	const to = { x: 1000, y: 900 };
	const waypoints = [
		{ x: 100, y: 450 },
		{ x: 900, y: 450 },
	];

	it("threads every waypoint as its own curve", () => {
		const path = edgePath(from, to, waypoints);
		// One leg out, one along the gutter, one in: three curves, not one.
		expect(path.match(/C /g)).toHaveLength(3);
		expect(path.startsWith("M 0,0")).toBe(true);
		expect(path.endsWith("1000,900")).toBe(true);
	});

	it("falls back to the plain cubic when there is nothing to route around", () => {
		expect(edgePath(from, to, [])).toBe(edgePath(from, to));
		expect(edgePath(from, to)).toBe("M 0,0 C 500,0 500,900 1000,900");
	});

	it("puts a routed label mid-GUTTER, not mid-chord", () => {
		// Mid-chord would drop it on whatever band the edge is routing past.
		expect(edgeLabelPoint(from, to, waypoints)).toEqual({ x: 500, y: 450 });
		expect(edgeLabelPoint(from, to)).toEqual({ x: 500, y: 450 });
	});
});

describe("openViewport", () => {
	const bbox = { minX: 0, minY: 0, maxX: 11000, maxY: 2200 };
	const movil = { width: 414, height: 868 };

	it("opens close enough to read, not fitted", () => {
		// Fitting this graph is z = 0.12, where a 16px line is under two device
		// pixels. The panel must not introduce itself that way.
		const fitted = fitViewport(HOST, bbox);
		const open = openViewport(HOST, bbox, movil);
		expect(fitted.z).toBeLessThan(0.2);
		expect(open.z).toBeGreaterThan(fitted.z);
		expect(open.z).toBeLessThanOrEqual(OPEN_ZOOM);
	});

	it("backs off only as far as the first screen needs", () => {
		// A desktop first screen cannot sit at 0.9 in a 1000px host.
		const wide = openViewport(HOST, bbox, { width: 1304, height: 824 });
		expect(wide.z).toBeLessThan(OPEN_ZOOM);
		expect(1304 * wide.z).toBeLessThanOrEqual(HOST.width);
	});

	it("anchors the journey's start where you begin reading", () => {
		const open = openViewport(HOST, bbox, movil);
		expect(open.tx).toBe(48);
		expect(open.ty).toBe(48);
	});

	it("opens NEAR, which is the invariant the sweep depends on", () => {
		// A canvas that opened in `far` would show cards for pages it has not
		// captured yet — and pressing «Ajustar» mid-sweep is what once stalled
		// it, because a live frame must never be swapped for a card. Opening
		// near is what keeps that path rare and recoverable.
		for (const first of [
			{ width: 414, height: 868 },
			{ width: 792, height: 1048 },
			{ width: 1304, height: 824 },
		]) {
			const open = openViewport(HOST, bbox, first);
			expect(detailAt(open.z, "far")).toBe("near");
		}
	});

	it("never zooms IN past what the whole graph needs", () => {
		// A single small screen already fits: opening must not scroll it away.
		const small = { minX: 0, minY: 0, maxX: 400, maxY: 300 };
		expect(openViewport(HOST, small, { width: 400, height: 300 })).toEqual(
			fitViewport(HOST, small),
		);
	});
});
