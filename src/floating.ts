"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CANVAS_ATTR } from "./canvas-gestures";

/**
 * A small box anchored to something on the canvas: the connect popover, the
 * right-click menu over a screen.
 *
 * Both are `position: fixed` over a world that pans, zooms and scrolls under
 * them, so both need the same two things — measure-then-place (a box placed
 * before it is measured flashes at 0,0 and cannot know whether it fits) and an
 * aggressive dismissal, because a fixed box whose anchor has moved is pointing
 * at nothing. The second copy of that lifecycle is what this exists to
 * prevent: the popover's version had already grown three non-obvious cases
 * (capture-phase scroll, window blur for focus entering an iframe, pointerdown
 * rather than click) that a hand-written second copy would have missed one of.
 * A fourth arrived here: that same blur only counts once the box has held
 * focus, because the click that summons it moves focus INTO a mirror iframe
 * and so blurs the parent window before the user has done anything at all.
 */

/**
 * Below the anchor; flipped above when it would leave the viewport; clamped
 * horizontally. Pure, so the flip-and-clamp arithmetic has a test.
 */
export function placePopover(
	anchor: { top: number; left: number; width: number; height: number },
	size: { width: number; height: number },
	viewport: { width: number; height: number },
): { top: number; left: number } {
	const margin = 8;
	let top = anchor.top + anchor.height + 6;
	if (top + size.height > viewport.height - margin) {
		top = Math.max(margin, anchor.top - size.height - 6);
	}
	const left = Math.min(
		Math.max(anchor.left, margin),
		Math.max(margin, viewport.width - size.width - margin),
	);
	return { top, left };
}

/** Whether a re-placement actually moved the box. Pure and named so the
 *  bail-out that keeps `useFloating` from spinning has a test of its own —
 *  the loop it prevents crashed a tab, and a guard that has never been
 *  exercised is a guard nobody knows is still connected. */
export function sameSpot(
	a: { top: number; left: number } | null,
	b: { top: number; left: number },
): boolean {
	return a !== null && a.top === b.top && a.left === b.left;
}

/**
 * Place a floating box against `anchor` and dismiss it when the world moves.
 *
 * Returns the ref to attach and the style to spread: `visibility: hidden`
 * until measured, then the placed coordinates. `key` re-places the box when
 * the same element is reused for a different anchor.
 *
 * **A caller should focus the box once `placed`** — that is what `placed`
 * exists for, and it is what arms the blur dismissal below. A caller that does
 * not is still covered (the window regaining focus arms it too), but it loses
 * one blur before the box starts closing on them.
 */
export function useFloating(
	anchor: { top: number; left: number; width: number; height: number },
	onDismiss: () => void,
	key?: unknown,
) {
	const { top, left, width, height } = anchor;
	const ref = useRef<HTMLDivElement>(null);
	/**
	 * Whether the box has held focus since this anchor. Gates the blur
	 * dismissal below, and a REF rather than an effect local because
	 * `useFloating` is designed to be re-anchored without remounting (`key`).
	 *
	 * It is deliberately NOT cleared on a re-anchor. It was, briefly, and that
	 * broke the ordinary case: a re-anchored popover does not take focus again
	 * (its focus effect keys on `placed`, which never flips back, and on an
	 * action that is a module constant), so clearing the flag left a box no
	 * blur could ever dismiss. The race a re-anchor DOES create — the blur from
	 * the click that re-anchors landing after that click — belongs to whoever
	 * owns the state, and `flows.tsx` settles it by refusing to let a box clear
	 * its successor.
	 */
	const held = useRef(false);
	const [at, setAt] = useState<{ top: number; left: number } | null>(null);
	const close = useRef(onDismiss);
	useEffect(() => {
		close.current = onDismiss;
	}, [onDismiss]);

	// Measured once, then placed — starting hidden, so there is no flash at
	// (0,0) on the first paint.
	//
	// Two guards against the loop this shape invites, and it is not
	// theoretical: place → setState → re-render → place crashed the tab the
	// first time a caller built its anchor inline. The deps are the anchor's
	// NUMBERS, never the object (a caller that writes `{ top: x, left: y }` in
	// its body hands over a new identity every render), and the state bails out
	// when the answer has not moved, so even a caller that defeats the deps
	// settles after one extra pass instead of spinning.
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		const next = placePopover(
			{ top, left, width, height },
			{ width: element.offsetWidth, height: element.offsetHeight },
			{ width: window.innerWidth, height: window.innerHeight },
		);
		setAt((prev) => (sameSpot(prev, next) ? prev : next));
	}, [top, left, width, height, key]);

	useEffect(() => {
		// Whatever had focus before the box took it. Restored on close, because
		// the box's own button is detached by then and focus falls to <body> —
		// which silently kills the canvas' arrow-key pan and zoom, with no
		// visible cause.
		const before = document.activeElement;
		const away = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node) || !ref.current?.contains(target)) close.current();
		};
		const gone = () => close.current();
		// A window blur only means "the user left" once the box has actually
		// held focus. Before that it is the summoning gesture still settling:
		// both of these boxes are opened by a click INSIDE a mirror iframe, and
		// that click moves focus into the iframe, which blurs the parent window.
		// Whether that blur lands before or after this listener attaches is not
		// something the spec pins, so a box could close in the same frame it
		// opened, on a browser nobody here can drive. Arming on the box's own
		// first focus decides it in our favour everywhere.
		// Captured, not re-read: React nulls the ref during the deletion
		// commit's mutation phase, before passive destroys run, so a cleanup
		// that reads `ref.current` removes nothing and only looks symmetric.
		const box = ref.current;
		const arm = () => {
			held.current = true;
		};
		const leave = () => {
			if (held.current) close.current();
		};
		document.addEventListener("pointerdown", away, true);
		// A focus change into ANY iframe — another mirror, the live frame —
		// blurs the parent window; that is the only way the parent hears it.
		window.addEventListener("blur", leave);
		// Capture phase: the board's own `overflow-auto` container is what
		// scrolls, and its scroll does not bubble.
		window.addEventListener("scroll", gone, true);
		window.addEventListener("resize", gone);
		box?.addEventListener("focusin", arm);
		// The box's own focus is the usual arm. The window regaining focus is
		// the caller-independent one: a box whose caller never focuses it then
		// dismisses on the NEXT blur rather than never, which is the failure
		// mode of gating a dismissal on something only the caller can deliver.
		window.addEventListener("focus", arm);
		return () => {
			document.removeEventListener("pointerdown", away, true);
			box?.removeEventListener("focusin", arm);
			window.removeEventListener("focus", arm);
			window.removeEventListener("blur", leave);
			window.removeEventListener("scroll", gone, true);
			window.removeEventListener("resize", gone);
			// ONLY when the removal actually stranded focus. This cleanup is
			// passive, so it runs on every unmount — the confirm path included,
			// where the popover closes and the composer card opens in the SAME
			// commit. React applies the card's `autoFocus` in the layout phase,
			// before this; restoring unconditionally then took the caret out of
			// the route field and gave it to a canvas that pans on arrow keys
			// and zooms on `+`. Whatever mounted alongside us has already
			// claimed focus and keeps it.
			const now = document.activeElement;
			if (now !== null && now !== document.body) return;
			// Back where it came from, unless that is not a place focus can
			// usefully live. An IFRAME is the common one — both boxes are
			// summoned FROM a mirror, and focusing it leaves the keyboard
			// talking to a sandboxed document. `<body>` is the other: it is what
			// `activeElement` reports when nothing holds focus, and "restoring"
			// to it is the same as not restoring. Either way the canvas host is
			// the right home, because it is what the pan and zoom keys listen
			// on, and losing them with no visible cause is what this prevents.
			const kept =
				before instanceof HTMLElement &&
				before.isConnected &&
				before.tagName !== "IFRAME" &&
				before !== document.body
					? before
					: null;
			(kept ?? document.querySelector<HTMLElement>(`[${CANVAS_ATTR}]`))?.focus();
		};
	}, []);

	return {
		ref,
		/** True once measured — the moment focus can actually be taken, since a
		 *  `visibility: hidden` element refuses it, and the moment the box may
		 *  be shown. One fact, not two inverses that can never disagree. */
		placed: at !== null,
		style: at ?? { top: 0, left: 0 },
	};
}
