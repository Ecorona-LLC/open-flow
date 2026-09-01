"use client";

import { createContext } from "react";

/**
 * How a node hands a zoom gesture back to the canvas it lives on.
 *
 * Wheel events over an iframe go to the IFRAME's document — the canvas' own
 * wheel listener is deaf exactly where most of the board's pixels are. So a
 * mirror forwards its ctrl/⌘-wheel (pinch) here, in PARENT viewport
 * coordinates, and the canvas zooms about that point as if the gesture had
 * landed on the background.
 *
 * A leaf module of its own so `frame.tsx` (the consumer) and `flow-canvas.tsx`
 * (the provider) need no import path between them — the existing frame ↔
 * screen-frame cycle is documented and safe, but there is no reason to grow it.
 */
export interface CanvasGestures {
	zoomAtClient: (clientX: number, clientY: number, deltaY: number, deltaMode: number) => void;
}

/**
 * The canvas viewport's zoom stamp, mirror of `SCALE_ATTR`: the canvas writes
 * its current zoom here so rect math can read back what actually drew the
 * frame. It lives in this leaf — not with its reader (`mapRect`) and not with
 * its writer (`flow-canvas`) — so the liftable canvas and the pick overlay
 * both depend on a module with no other weight.
 */
export const ZOOM_ATTR = "data-workbench-zoom";

/** Null outside a canvas: a mirror on some future non-canvas board simply
 *  keeps the browser's default pinch behaviour suppressed and forwards to
 *  nobody. */
export const CanvasGesturesContext = createContext<CanvasGestures | null>(null);

/**
 * The CSS custom property carrying the canvas' current zoom, written on the
 * transform layer beside `ZOOM_ATTR`.
 *
 * This is how chrome stays a constant size on screen without React hearing
 * about the zoom at all: an element that counter-scales by `1 / var(--wb-z)`
 * is recomputed by the browser on the same frame the transform changes. The
 * alternative — pushing `z` through context or state — would re-render every
 * node, and therefore every mirror, sixty times a second.
 */
export const ZOOM_VAR = "--wb-z";

/**
 * The width of the node a piece of chrome belongs to, in world px. Written by
 * the canvas on each chrome box; read by chrome that clamps itself, so a name
 * truncates instead of overprinting the screen next door.
 */
export const NODE_WIDTH_VAR = "--wb-node-w";

/**
 * The canvas' own background, for the knockout behind an edge label. The HOST
 * sets it — a lifted canvas with no declaration falls back to a light value,
 * which is why the fallback is documented here rather than hidden at the use
 * site: get it wrong in dark mode and every «vía» wears a pale halo.
 */
export const CANVAS_BG_VAR = "--wb-canvas-bg";

/**
 * One screen pixel, expressed in the world units a frame is drawn in.
 *
 * Borders, radii and shadows read it so a frame stays an OBJECT at any zoom —
 * a 1px border under a 0.12 transform is 0.12px, which is why the board once
 * read as bare rectangles. Its fallback is a literal `1px`, so a frame outside
 * a canvas is byte-identical to what it always was.
 */
export const EDGE_VAR = "--wb-edge";

/**
 * How much detail the canvas is close enough to show.
 *
 * Coarse ON PURPOSE. Anything finer would have to be React state changing at
 * gesture rate; this flips a handful of times in a session, so the components
 * that read it re-render a handful of times. `far` is a map of the journey —
 * names only; `near` is the workbench — every chip and «vía» label.
 */
export type CanvasDetail = "far" | "near";

/** Zoom at or above which chips, links and «vía» labels are drawn… */
export const DETAIL_IN = 0.55;
/** …and below which they are dropped again. The gap between the two is
 *  deliberate: one threshold would thrash on the jitter of a real pinch. */
export const DETAIL_OUT = 0.45;

/** Which side of the threshold a zoom lands on, given where it was. */
export function detailAt(z: number, previous: CanvasDetail): CanvasDetail {
	if (z >= DETAIL_IN) return "near";
	if (z <= DETAIL_OUT) return "far";
	return previous;
}

/** `near` outside a canvas: a board that is not zoomable is always close. */
export const CanvasDetailContext = createContext<CanvasDetail>("near");

/** The canvas host itself — what the pan and zoom keys listen on, and so the
 *  right home for focus when a floating box closes. Named here beside the
 *  other canvas contracts (`ZOOM_ATTR`, `EDGE_VAR`, …) rather than written as
 *  a literal in two modules, which is how a rename half-lands. */
export const CANVAS_ATTR = "data-workbench-canvas";
