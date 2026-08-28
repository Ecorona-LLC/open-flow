"use client";

import type { ResolvedNode } from "./hover-inspect";
import { SCALE_ATTR } from "./screen-frame";

/**
 * The outline, and the label that sits **on** the element.
 *
 * A card in the corner makes you look away from the thing you are pointing at.
 * This draws a hairline over the element's real bounds and docks a small tag
 * directly above it — below when there is no room at the top of the viewport.
 *
 * Used by both surfaces (the live overlay on real routes, and the workbench's
 * own edit mode) so picking feels like one tool wherever you are.
 */
export interface PickTarget {
	rect: { top: number; left: number; width: number; height: number };
	node: ResolvedNode;
}

const TAG_HEIGHT = 20;

/**
 * Viewport coordinates for an element that may live inside a scaled,
 * same-origin iframe. The workbench renders flow frames at a device width and
 * `transform: scale(…)` them down, so a raw rect from inside the frame is both
 * offset and the wrong size.
 */
export function mapRect(element: Element, frame: HTMLIFrameElement | null) {
	const rect = element.getBoundingClientRect();
	if (!frame) {
		return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
	}
	// Read back from what actually drew the frame, not derived a second time
	// from `frameRect.width / offsetWidth`. Two independent derivations of one
	// number is how an outline ends up where the frame isn't.
	const stamped = frame.closest(`[${SCALE_ATTR}]`)?.getAttribute(SCALE_ATTR);
	const parsed = Number(stamped);
	const scale = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
	const frameRect = frame.getBoundingClientRect();
	return {
		top: frameRect.top + rect.top * scale,
		left: frameRect.left + rect.left * scale,
		width: rect.width * scale,
		height: rect.height * scale,
	};
}

/**
 * `LandingHero · landing-hero.tsx · landing`, degrading gracefully.
 *
 * On a server-rendered route there is no component to name, but the surface is
 * still known from the route — so the label reads `<h1> · landing` rather than
 * dropping the one fact we do have.
 */
export function describeNode(node: ResolvedNode): string {
	const head = node.component ?? `<${node.tag}>`;
	const file = node.component && node.file ? node.file.split("/").pop() : null;
	return [head, file, node.surface].filter(Boolean).join(" · ");
}

export function PickHighlight({ target }: { target: PickTarget | null }) {
	if (!target) return null;
	const { rect, node } = target;
	const above = rect.top > TAG_HEIGHT + 4;

	return (
		<div
			aria-hidden
			className="pointer-events-none fixed z-[2147483000]"
			style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
		>
			<div className="absolute inset-0 border border-amber-400" />
			<span
				className="absolute left-0 whitespace-nowrap rounded-sm bg-amber-400 px-1.5 py-0.5 font-mono text-[10px] leading-none text-amber-950 shadow-sm"
				style={above ? { top: -TAG_HEIGHT } : { bottom: -TAG_HEIGHT }}
			>
				{describeNode(node)}
			</span>
		</div>
	);
}
