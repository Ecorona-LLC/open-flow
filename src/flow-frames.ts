import type { StepNode } from "./flow-layout";
import type { Sketch } from "./screen-sketch";

/**
 * The sweep's ledger, keyed by `StepNode.key` — never by position.
 *
 * Indexed by position, adding one screen renumbered every entry after it: the
 * whole board re-swept on each gesture, and a mirror could land under the
 * wrong screen if a capture was in flight while the manifest hot-reloaded.
 * Keyed by `lane:position:route`, an appended screen is one new key, a
 * removed tail is one dead key, and every other mirror stays exactly where it
 * was. The functions are pure so the rules are testable without a DOM.
 */

/** Where a step's frame is in its life. See the flows panel docs for the loop. */
export type StepFrame =
	| { kind: "queued" }
	/** `ticket` is monotonic per capture attempt, so the watchdog and the
	 *  resolution can tell "still THIS capture" from "a newer one". */
	| { kind: "capturing"; ticket: number }
	/** `sketch` is what the canvas draws at a distance instead of minifying
	 *  the page into mush; it is measured during this same capture, because
	 *  the mirror is inert and could never be asked afterwards. */
	| { kind: "mirrored"; srcdoc: string; sketch: Sketch | null; capturedAt: number }
	/** Never settled or never loaded; the frame stays live instead. */
	| { kind: "restless" }
	/** No page at this route yet: a spec card, outside the sweep entirely. */
	| { kind: "unbuilt" };

export const QUEUED: StepFrame = { kind: "queued" };
export const UNBUILT: StepFrame = { kind: "unbuilt" };

export type Frames = ReadonlyMap<string, StepFrame>;

export const NO_FRAMES: Frames = new Map();

/** The step decides "unbuilt", never the ledger: a rescan can build a page
 *  under a stale entry, and a stale `queued` under a spec card once held the
 *  capture slot hostage for the full watchdog. A missing entry is queued. */
export function frameOf(frames: Frames, node: StepNode): StepFrame {
	if (!node.step.exists) return UNBUILT;
	return frames.get(node.key) ?? QUEUED;
}

/** The key the sweep should capture next: none while one is in flight, else
 *  the first queued step in flat order — one capture in flight, ever. */
export function nextCapture(frames: Frames, nodes: readonly StepNode[]): string | null {
	for (const node of nodes) {
		if (frameOf(frames, node).kind === "capturing") return null;
	}
	for (const node of nodes) {
		if (frameOf(frames, node).kind === "queued") return node.key;
	}
	return null;
}

export function withFrame(frames: Frames, key: string, frame: StepFrame): Frames {
	const next = new Map(frames);
	next.set(key, frame);
	return next;
}

/** Drop entries whose step left the board — a 2 MB srcdoc must not outlive
 *  its screen. A step that became UNBUILT counts as left: its entry is a
 *  snapshot of a page that no longer exists, and serving it again if the
 *  route is later rebuilt would show the pre-deletion page. Identity-stable
 *  when nothing died, so effects keyed on the ledger do not re-fire. */
export function prune(frames: Frames, nodes: readonly StepNode[]): Frames {
	const keep = new Set(nodes.filter((node) => node.step.exists).map((node) => node.key));
	if ([...frames.keys()].every((key) => keep.has(key))) return frames;
	const next = new Map<string, StepFrame>();
	for (const [key, frame] of frames) {
		if (keep.has(key)) next.set(key, frame);
	}
	return next;
}
