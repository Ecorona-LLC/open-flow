"use client";

import { readSketch, type Sketch } from "./screen-sketch";

/**
 * Mirrors — a captured snapshot of a live frame, so the storyboard can show
 * every step while at most one step is a live document.
 *
 * Each flow step used to be a live same-origin iframe of the real route: up to
 * 12 steps, ×2 boards in split theme — 24 concurrent full route loads. Under
 * `next dev` every one of those is a compile held in the server heap, an RSC
 * render, a React dev runtime and its own HMR socket; a host's dev server
 * reached ~7 GB just by opening the panel.
 *
 * A mirror is the same pixels without any of that: the settled DOM serialized
 * into a `srcdoc` iframe with scripts stripped. No request, no runtime, no
 * socket — and the split board's dark twin is the same capture with `.dark`
 * toggled, so it costs nothing at all.
 *
 * The capture can fail — a document that never stops mutating, a frame that
 * never loads. Failure is never a blank step: the frame simply stays live, the
 * bounded worst case being exactly what every frame used to be.
 */

/**
 * A capture waits for this long without a single DOM mutation. A fixed delay
 * was wrong in both directions: client components and streamed RSC content
 * render *after* `load`, so a short timer snapshots half a page, and a long
 * one stalls the sweep on pages that settled instantly.
 */
export const QUIET_MS = 500;

/**
 * A document animating via the DOM (a spinner, a ticking clock) never goes
 * quiet. After this long the capture gives up and the step stays live instead
 * — a truthful live frame beats a mirror of a page mid-animation.
 */
export const CAPTURE_MAX_MS = 8000;

/**
 * The sweep abandons a capture whose frame never even fires `load` after this
 * long, marking the step live-without-a-mirror so the rest of the storyboard
 * is not held hostage. Generous on purpose: a first dev-mode compile of a
 * heavy route takes tens of seconds.
 */
export const CAPTURE_TOTAL_MS = 30_000;

/**
 * A mirror bigger than this stays live instead. The panel exists to stop the
 * viewer from eating memory; trading the dev server's 7 GB for an unbounded
 * pile of multi-megabyte DOM strings in React state would be the same bug in
 * a new home.
 */
export const MIRROR_MAX_BYTES = 2_000_000;

/**
 * The settled DOM as standalone HTML.
 *
 * Scripts, `<noscript>` and inline `on*` handlers are stripped — the mirror
 * must never boot the app a second time — and any `<base>` the page carried is
 * replaced with the route's own URL: inside `srcdoc` the base is
 * `about:srcdoc`, so without it every relative stylesheet, image and font
 * would resolve against nothing.
 */
export function serializeMirror(doc: Document, route: string, origin: string): string {
	const source = doc.documentElement;
	if (!source) throw new Error("documento sin raíz");
	const root = source.cloneNode(true) as HTMLElement;

	for (const node of Array.from(root.querySelectorAll("script, noscript, base"))) {
		node.remove();
	}
	for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
		for (const attribute of Array.from(element.attributes)) {
			if (attribute.name.toLowerCase().startsWith("on")) {
				element.removeAttribute(attribute.name);
			}
		}
	}

	const base = doc.createElement("base");
	base.setAttribute("href", new URL(route, origin).href);
	const head = root.querySelector("head");
	if (head) {
		head.insertBefore(base, head.firstChild);
	} else {
		root.insertBefore(base, root.firstChild);
	}

	const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : "<!DOCTYPE html>";
	return `${doctype}${root.outerHTML}`;
}

/**
 * Resolves once the document has gone `quietMs` without a mutation, or
 * `restless` when `maxMs` passes first.
 */
export function whenQuiet(
	doc: Document,
	quietMs: number = QUIET_MS,
	maxMs: number = CAPTURE_MAX_MS,
): Promise<"quiet" | "restless"> {
	return new Promise((resolve) => {
		let settle: ReturnType<typeof setTimeout> | undefined;
		let cap: ReturnType<typeof setTimeout> | undefined;
		const observer = new MutationObserver(() => {
			clearTimeout(settle);
			settle = setTimeout(() => finish("quiet"), quietMs);
		});
		const finish = (verdict: "quiet" | "restless") => {
			observer.disconnect();
			clearTimeout(settle);
			clearTimeout(cap);
			resolve(verdict);
		};
		const root = doc.documentElement;
		if (!root) {
			resolve("restless");
			return;
		}
		observer.observe(root, {
			childList: true,
			subtree: true,
			attributes: true,
			characterData: true,
		});
		settle = setTimeout(() => finish("quiet"), quietMs);
		cap = setTimeout(() => finish("restless"), maxMs);
	});
}

/** What one successful capture yields. */
export interface Capture {
	srcdoc: string;
	/** The page's shape, for the canvas to draw when it is too far away for
	 *  the page itself to be legible. Null when it could not be measured. */
	sketch: Sketch | null;
}

/**
 * Capture a loaded live frame into a mirror, or `null` when it cannot be
 * done — the caller's contract is that `null` means "leave the frame live",
 * never "show nothing".
 */
export async function captureMirror(
	frame: HTMLIFrameElement,
	route: string,
): Promise<Capture | null> {
	try {
		const doc = frame.contentDocument;
		if (!doc) return null;
		if ((await whenQuiet(doc)) === "restless") return null;
		// Re-read: a navigation during the quiet wait replaces the document,
		// and serializing the abandoned one would mirror a page that is gone.
		const settled = frame.contentDocument;
		if (!settled) return null;
		// The route the frame is on NOW — a live frame can be navigated, and
		// stamping the original route as <base> made every relative asset in
		// the mirror of the new page resolve against the old one.
		const liveRoute = frame.contentWindow?.location.pathname ?? route;
		const html = serializeMirror(settled, liveRoute, window.location.origin);
		if (html.length > MIRROR_MAX_BYTES) return null;
		// Measured from the LIVE document, now, while the geometry exists: the
		// mirror runs no script and can never be asked for a rect later.
		let sketch: Sketch | null = null;
		try {
			sketch = readSketch(settled, {
				width: frame.contentWindow?.innerWidth ?? frame.clientWidth,
				height: frame.contentWindow?.innerHeight ?? frame.clientHeight,
			});
		} catch {
			// A sketch is an enhancement; the mirror is the contract.
		}
		return { srcdoc: html, sketch };
	} catch {
		// Cross-origin, detached, mid-teardown — all mean "stay live".
		return null;
	}
}
