"use client";

import { ZOOM_ATTR } from "./canvas-gestures";
import { cx } from "./cx";
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

/** How far from the viewport's top edge a tag needs before it may sit ABOVE
 *  the element it labels. Two numbers because the tag has two shapes, and both
 *  are the rendered height plus its 3px gap — a single constant was a height
 *  the tag stopped having when its content began deciding it. */
const BARE_TAG = 25;
const HINTED_TAG = 44;

function stampedFactor(frame: HTMLIFrameElement, attribute: string): number {
	const stamped = frame.closest(`[${attribute}]`)?.getAttribute(attribute);
	const parsed = Number(stamped);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * Viewport coordinates for an element that may live inside a scaled,
 * same-origin iframe. The workbench renders flow frames at a device width and
 * `transform: scale(…)` them down — and on the flow canvas one viewport
 * transform zooms every frame at once — so a raw rect from inside the frame
 * is both offset and the wrong size.
 */
export function mapRect(element: Element, frame: HTMLIFrameElement | null) {
	const rect = element.getBoundingClientRect();
	if (!frame) {
		return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
	}
	// Read back from what actually drew the frame, not derived a second time
	// from `frameRect.width / offsetWidth`. Two independent derivations of one
	// number is how an outline ends up where the frame isn't. The effective
	// factor is the PRODUCT of both stamps: a per-frame `scale(…)` and the
	// canvas zoom compose, and each defaults to 1 where absent (frame-view and
	// the components panel have no zoom ancestor; canvas nodes stamp scale 1).
	// The translate side needs no correction — `frameRect` is post-transform.
	const scale = stampedFactor(frame, SCALE_ATTR) * stampedFactor(frame, ZOOM_ATTR);
	const frameRect = frame.getBoundingClientRect();
	return {
		top: frameRect.top + rect.top * scale,
		left: frameRect.left + rect.left * scale,
		width: rect.width * scale,
		height: rect.height * scale,
	};
}

/** A point from inside a frame's document, in parent viewport coordinates —
 *  the same composition `mapRect` uses, for events instead of elements. */
export function mapPoint(x: number, y: number, frame: HTMLIFrameElement) {
	const scale = stampedFactor(frame, SCALE_ATTR) * stampedFactor(frame, ZOOM_ATTR);
	const frameRect = frame.getBoundingClientRect();
	return { x: frameRect.left + x * scale, y: frameRect.top + y * scale };
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

/** Each tool's colour, so one glance says which gesture is armed: amber is
 *  Editar's pin, sky is the storyboard's connect. */
const TONES = {
	amber: { border: "border-amber-400", tag: "bg-amber-400 text-amber-950" },
	sky: { border: "border-sky-400", tag: "bg-sky-400 text-sky-950" },
} as const;

/**
 * The hairline and its docked tag, for anything that outlines an element.
 *
 * The tag is two lines when it has a `hint`, and that is the point: the first
 * names WHAT is under the pointer, the second says what the buttons do. Run
 * together on one line — which is how the connect gesture first shipped — the
 * instruction was longer than the fact, both were set in code type, and the
 * whole bar was wider than the 390px screen it annotated, so it covered the
 * neighbour. Two short lines, the prose in prose type, capped so it cannot
 * spill past its own screen.
 *
 * Anchored by percentage rather than a fixed offset: the tag's height now
 * depends on whether there is a hint, and a constant would have overlapped the
 * very element it labels.
 */
export function Outline({
	rect,
	label,
	hint,
	tone = "amber",
}: {
	rect: { top: number; left: number; width: number; height: number };
	label: string;
	/** What the gesture would do. Quieter than the label, and never code. */
	hint?: string;
	tone?: keyof typeof TONES;
}) {
	// The hinted tag is two capped lines (~40px); the bare one is a single
	// nowrap line (~25px), each already including the 3px gap.
	const above = rect.top > (hint ? HINTED_TAG : BARE_TAG);
	return (
		<div
			aria-hidden
			className="pointer-events-none fixed z-[2147483000]"
			style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
		>
			<div className={cx("absolute inset-0 border", TONES[tone].border)} />
			<span
				className={cx(
					"absolute left-0 rounded-sm px-1.5 text-[10px] shadow-sm",
					// Only the HINTED tag is the new two-line block. The bare one
					// keeps the geometry it always had, because its other caller is
					// the ⌥P pin that ships into every host app's root layout, and
					// its label — `Component · file.tsx · surface` — carries the two
					// facts it exists to deliver at the END of the string, where a
					// 22rem clamp would have eaten them.
					hint
						? "flex max-w-[22rem] flex-col py-1 leading-[1.45]"
						: "whitespace-nowrap py-0.5 leading-none",
					TONES[tone].tag,
				)}
				style={above ? { bottom: "100%", marginBottom: 3 } : { top: "100%", marginTop: 3 }}
			>
				<span className={cx("font-mono", hint && "truncate")}>{label}</span>
				{hint && <span className="truncate font-sans opacity-70">{hint}</span>}
			</span>
		</div>
	);
}

export function PickHighlight({ target }: { target: PickTarget | null }) {
	if (!target) return null;
	return <Outline rect={target.rect} label={describeNode(target.node)} />;
}
