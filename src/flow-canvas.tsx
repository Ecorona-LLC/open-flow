"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
	CANVAS_BG_VAR,
	CANVAS_ATTR,
	CanvasDetailContext,
	DETAIL_IN,
	CanvasGesturesContext,
	detailAt,
	NODE_WIDTH_VAR,
	ZOOM_ATTR,
	ZOOM_VAR,
	type CanvasDetail,
	type CanvasGestures,
} from "./canvas-gestures";
import { cx } from "./cx";

/**
 * A pan/zoom canvas: absolutely-placed nodes and bezier edges under ONE
 * viewport transform. Our own react-flow, sized to what the workbench needs —
 * and nothing else: this module knows no flows, no manifests, no panels, so it
 * can be lifted whole into another repo.
 *
 * `onContextMenu` on a node is the one pointer seam this module offers, and it
 * stays the one: it carries viewport coordinates and nothing domain-shaped, so
 * a lifted canvas inherits a working gesture and no obligations. A caller that
 * needs another wraps its own `element` — a prop per gesture would bake this
 * repo's policy into the primitive.
 *
 * The one transform is the design. Every node renders at its natural size
 * (`scale(1)` world units) and `translate(tx,ty) scale(z)` on a single layer
 * does all scaling — so an iframe inside a node keeps its truthful device
 * width, and rect math needs exactly one extra factor, stamped here as
 * `ZOOM_ATTR` for `mapRect` to read back. Per-node transforms would mean N
 * compositor layers and N places for the math to drift.
 *
 * Anything `position: fixed` (outlines, popovers) must stay OUTSIDE this
 * component: a transformed ancestor becomes the containing block for fixed
 * descendants and quietly turns "fixed to the screen" into "fixed to the
 * canvas".
 */

export interface CanvasViewport {
	/** Host-space translation, px. */
	tx: number;
	ty: number;
	/** Zoom: world px → host px. */
	z: number;
}

export interface CanvasNode {
	key: string;
	x: number;
	y: number;
	width: number;
	height: number;
	element: ReactNode;
	/**
	 * Chrome anchored to this node — names, chips, links. Drawn in a second
	 * pass that carries no paint containment, because `content-visibility`
	 * clips to the padding box and constant-size chrome deliberately sits
	 * OUTSIDE the screen it labels.
	 */
	chrome?: ReactNode;
	/**
	 * Opt this node out of `content-visibility: auto`. For a node that must
	 * keep working offscreen — a live iframe mid-capture, a card holding
	 * focus — display-locking would throttle the very rAF/observer activity
	 * its settling depends on.
	 */
	alwaysRender?: boolean;
	/** Painted before every other node — the band sections behind the screens. */
	behind?: boolean;
	/** Names the chrome group for assistive tech, since chrome and its screen
	 *  are separate subtrees. */
	chromeLabel?: string;
	/**
	 * Right-click on this node, in viewport coordinates. Needed here and not
	 * only inside the frames: a node at a far zoom is a drawing, not an
	 * iframe, so there is no inner document to forward from — and far is
	 * exactly where the constant-size chrome is hidden and a menu is the only
	 * way to reach a screen's actions.
	 *
	 * What the gesture MEANS is entirely the caller's; the canvas only
	 * translates coordinates. A node that supplies this has claimed the
	 * gesture, which is why the browser menu is suppressed here — a node that
	 * does not supply it keeps its own.
	 */
	onContextMenu?: (at: { x: number; y: number }) => void;
}

export interface CanvasEdgeProp {
	id: string;
	from: { x: number; y: number };
	to: { x: number; y: number };
	label: string | null;
	variant: "solid" | "dashed";
	/** Points the path threads on its way — a fork routed through a gutter. */
	waypoints?: ReadonlyArray<{ x: number; y: number }>;
}

export interface CanvasBBox {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export const MIN_ZOOM = 0.1;
/**
 * What the canvas opens at: close enough that the first screens are legible.
 * «Ajustar» is a command, not a default — a fitted ten-screen flow puts a
 * 16px line on two device pixels, and opening there taught people the panel
 * was blurry before they ever pressed anything.
 */
export const OPEN_ZOOM = 0.9;
export const MAX_ZOOM = 2;
/** Host-edge padding a fit and a reveal both keep clear. */
export const FIT_PAD = 48;

/* ---------------------------------------------------------------- math */
/* Pure and exported: the gesture arithmetic is where a canvas rots, so it
 * is testable without a DOM. */

const clampZ = (z: number, min: number, max: number) => Math.min(max, Math.max(min, z));

/**
 * Zoom by factor `k` keeping the host-space point `(cx, cy)` fixed — the
 * world point under the cursor stays under the cursor.
 *
 * The floor yields to the CURRENT zoom: a fit of a very long flow can sit
 * below `MIN_ZOOM`, and clamping up from there would make "zoom out" jump IN.
 * Gestures can stay below the floor; they can never dive further under it.
 */
export function zoomAt(
	viewport: CanvasViewport,
	cx: number,
	cy: number,
	k: number,
	min = MIN_ZOOM,
	max = MAX_ZOOM,
): CanvasViewport {
	const z = clampZ(viewport.z * k, Math.min(min, viewport.z), max);
	if (z === viewport.z) return viewport;
	const ratio = z / viewport.z;
	return {
		z,
		tx: cx - (cx - viewport.tx) * ratio,
		ty: cy - (cy - viewport.ty) * ratio,
	};
}

/**
 * Wheel delta → zoom factor. Exponential, so equal wheel travel means equal
 * zoom RATIO in both directions. `deltaMode` 1 (Firefox line mode) arrives in
 * lines, not pixels — ×16 approximates a line; mode 2 (page) is a page's
 * worth, ×160. Safari's trackpad pinch arrives as ctrl-wheel like everywhere
 * else; its proprietary GestureEvents are deliberately unhandled.
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
	const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 160 : deltaY;
	return Math.exp(-pixels * 0.0015);
}

/**
 * The viewport that shows the whole bbox: zoomed to fit both axes with
 * `pad` clear, never past 1:1 (mirrors above natural size read as a bug,
 * not generosity), centered on both axes. NOT floored at `MIN_ZOOM` — that
 * floor is for gestures; a fit that stopped at it would silently clip a
 * long flow, and «Ajustar»'s one promise is the whole graph.
 */
export function fitViewport(
	host: { width: number; height: number },
	bbox: CanvasBBox,
	pad = FIT_PAD,
): CanvasViewport {
	const width = bbox.maxX - bbox.minX;
	const height = bbox.maxY - bbox.minY;
	if (width <= 0 || height <= 0) {
		return { z: 1, tx: host.width / 2 - bbox.minX, ty: host.height / 2 - bbox.minY };
	}
	const available = {
		width: Math.max(1, host.width - pad * 2),
		height: Math.max(1, host.height - pad * 2),
	};
	const z = Math.min(available.width / width, available.height / height, 1);
	return {
		z,
		tx: (host.width - width * z) / 2 - bbox.minX * z,
		ty: (host.height - height * z) / 2 - bbox.minY * z,
	};
}

/**
 * Where the canvas opens: the graph's start at a readable zoom, backed off
 * only as far as the first screen needs to fit.
 *
 * The old default was `fitViewport`, which is honest about the shape and
 * useless about the content — the panel's first impression was a blurry
 * ribbon. Fit is one button away and now shows a map worth reading.
 */
export function openViewport(
	host: { width: number; height: number },
	bbox: CanvasBBox,
	first: { width: number; height: number } | null,
	pad = FIT_PAD,
): CanvasViewport {
	const fitted = fitViewport(host, bbox, pad);
	// Never zoom IN past what the whole graph needs — a one-screen flow should
	// not open scrolled.
	const ceiling = Math.max(fitted.z, OPEN_ZOOM);
	const needed = first
		? Math.min(
				(host.width - pad * 2) / Math.max(1, first.width),
				(host.height - pad * 2) / Math.max(1, first.height),
			)
		: ceiling;
	// Floored at the detail threshold: a first screen too tall for the host
	// (a 1048px tablet in a 600px panel) would otherwise open BELOW it, and
	// the panel's first impression would be a card for a page it has not even
	// captured yet. Cropped and real beats whole and abstract — the fit button
	// is right there. A test pins that this can never open `far`.
	const z = Math.min(ceiling, Math.max(fitted.z, DETAIL_IN, Math.min(OPEN_ZOOM, needed)));
	if (z === fitted.z) return fitted;
	// Anchored at the graph's top-left, so the journey starts where you read.
	return { z, tx: pad - bbox.minX * z, ty: pad - bbox.minY * z };
}

/**
 * The smallest pan that brings a node's box inside the host with `pad`
 * clear. Never re-zooms — a reveal that changes the zoom under an open
 * card is disorienting. A box too large for the host aligns its top-left.
 */
export function revealViewport(
	viewport: CanvasViewport,
	host: { width: number; height: number },
	box: { x: number; y: number; width: number; height: number },
	pad = FIT_PAD,
): CanvasViewport {
	const shift = (start: number, size: number, hostSize: number): number => {
		if (size + pad * 2 > hostSize) return pad - start;
		if (start < pad) return pad - start;
		const end = start + size;
		if (end > hostSize - pad) return hostSize - pad - end;
		return 0;
	};
	const left = viewport.tx + box.x * viewport.z;
	const top = viewport.ty + box.y * viewport.z;
	const dx = shift(left, box.width * viewport.z, host.width);
	const dy = shift(top, box.height * viewport.z, host.height);
	if (dx === 0 && dy === 0) return viewport;
	return { ...viewport, tx: viewport.tx + dx, ty: viewport.ty + dy };
}

interface Point {
	x: number;
	y: number;
}

/**
 * The path an edge draws. Unrouted, it is one cubic out of the right side and
 * into the left side. Routed, it threads the given waypoints — out of the
 * source, along the gutter, up into the target — with each corner smoothed by
 * a cubic, so an edge that must pass a whole band never crosses a screen.
 */
export function edgePath(from: Point, to: Point, waypoints?: readonly Point[]): string {
	if (!waypoints || waypoints.length === 0) {
		const mx = (from.x + to.x) / 2;
		return `M ${from.x},${from.y} C ${mx},${from.y} ${mx},${to.y} ${to.x},${to.y}`;
	}
	const points = [from, ...waypoints, to];
	let path = `M ${from.x},${from.y}`;
	for (let index = 1; index < points.length; index += 1) {
		const previous = points[index - 1];
		const point = points[index];
		if (!previous || !point) continue;
		// Control points on the axis each leg travels: horizontal legs bend
		// horizontally, the vertical drop bends vertically. That is what makes
		// the corners read as rounded rather than as a diagonal.
		const horizontal = Math.abs(point.x - previous.x) >= Math.abs(point.y - previous.y);
		const c1 = horizontal
			? { x: (previous.x + point.x) / 2, y: previous.y }
			: { x: previous.x, y: (previous.y + point.y) / 2 };
		const c2 = horizontal
			? { x: (previous.x + point.x) / 2, y: point.y }
			: { x: point.x, y: (previous.y + point.y) / 2 };
		path += ` C ${c1.x},${c1.y} ${c2.x},${c2.y} ${point.x},${point.y}`;
	}
	return path;
}

/** Where an edge's label sits: mid-chord, or mid-gutter on a routed edge. */
export function edgeLabelPoint(from: Point, to: Point, waypoints?: readonly Point[]) {
	if (waypoints && waypoints.length >= 2) {
		const first = waypoints[0];
		const last = waypoints[waypoints.length - 1];
		if (first && last) return { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
	}
	return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

/* ----------------------------------------------------------- component */

const KEY_PAN = 60;

export function FlowCanvas({
	nodes,
	edges,
	bbox,
	fitKey,
	reveal,
	onViewportChange,
	onDetailChange,
	label,
	className,
}: {
	nodes: readonly CanvasNode[];
	edges: readonly CanvasEdgeProp[];
	bbox: CanvasBBox;
	/** Changing this refits the whole graph once (e.g. a device preset switch). */
	fitKey?: string;
	/**
	 * Pans a named node into view once. The `tick` is what makes it "once":
	 * asking twice for the same key (remove a screen, add it back) must pan
	 * twice, and a bare key would compare equal and never fire again.
	 */
	reveal?: { key: string; tick: number } | null;
	/** Fires on EVERY viewport tick — the panel closes its fixed overlays here. */
	onViewportChange?: (viewport: CanvasViewport) => void;
	/**
	 * Fires when the canvas crosses the detail threshold. The panel needs it
	 * because a flip REMOUNTS every mirror, and anything that instruments
	 * iframes at attach time is talking to elements that no longer exist.
	 */
	onDetailChange?: (detail: CanvasDetail) => void;
	label: string;
	className?: string;
}) {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const gridRef = useRef<HTMLDivElement | null>(null);
	const layerRef = useRef<HTMLDivElement | null>(null);
	// Null until the host is measured: rendering one frame at a guessed
	// viewport then snapping to the fit is a visible flash.
	const [viewport, setViewport] = useState<CanvasViewport | null>(null);
	// Coarse, hysteretic, and therefore cheap: this flips a few times per
	// session, so the chrome that reads it re-renders a few times per session.
	const [detail, setDetail] = useState<CanvasDetail>("near");
	const gestured = useRef(false);
	const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
	const markerId = useId();

	const fit = (mode: "fit" | "open" = "fit") => {
		const host = hostRef.current;
		if (!host) return;
		const rect = host.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return;
		const size = { width: rect.width, height: rect.height };
		const first = nodes.find((node) => !node.behind && node.width > 1) ?? null;
		setViewport(
			mode === "open"
				? openViewport(size, bbox, first && { width: first.width, height: first.height })
				: fitViewport(size, bbox),
		);
	};
	const fitRef = useRef(fit);
	fitRef.current = fit;

	// First measure → first fit. Layout effect so the first painted frame is
	// already the fitted one.
	useLayoutEffect(() => {
		fitRef.current("open");
		// The empty dependency list is deliberate: refitting on every bbox
		// change would yank the camera every time a step lands.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// An explicit refit request (device preset switched, flow changed).
	const firstFitKey = useRef(true);
	useEffect(() => {
		if (firstFitKey.current) {
			firstFitKey.current = false;
			return;
		}
		gestured.current = false;
		fitRef.current("open");
	}, [fitKey]);

	// Until the user pans or zooms, a host resize keeps the fit honest — the
	// panel's first layout often settles a few frames after mount.
	useEffect(() => {
		const host = hostRef.current;
		if (!host || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => {
			if (!gestured.current) fitRef.current("open");
		});
		observer.observe(host);
		return () => observer.disconnect();
	}, []);

	// Reveal: pan (never zoom) until the named node is fully visible.
	useEffect(() => {
		onDetailChange?.(detail);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [detail]);

	useEffect(() => {
		if (!reveal) return;
		const node = nodes.find((candidate) => candidate.key === reveal.key);
		const host = hostRef.current;
		if (!node || !host) return;
		const rect = host.getBoundingClientRect();
		setViewport((current) =>
			current ? revealViewport(current, { width: rect.width, height: rect.height }, node) : current,
		);
		// Only when a new REQUEST arrives: re-running on node identity would
		// fight the user's pan while a card re-renders on every keystroke.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [reveal?.tick]);

	useEffect(() => {
		if (!viewport) return;
		onViewportChange?.(viewport);
		// Functional and hysteretic: a zoom that stays inside the dead band
		// returns the same value, so React bails and nothing re-renders.
		setDetail((current) => {
			const next = detailAt(viewport.z, current);
			// Zooming out unmounts the controls; if one of them had focus it
			// would land on <body> and Tab would restart at the top of the
			// document. Catch it on the way to the canvas instead.
			if (next === "far" && current === "near") {
				const host = hostRef.current;
				const focused = host?.ownerDocument.activeElement;
				if (host && focused instanceof HTMLElement && host.contains(focused) && focused !== host) {
					host.focus();
				}
			}
			return next;
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [viewport]);

	// React's synthetic wheel listeners are passive — preventDefault would be
	// ignored and the page behind the canvas would scroll/zoom. Manual and
	// non-passive, like the mirrors' own listeners.
	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		const onWheel = (event: WheelEvent) => {
			// A plain wheel over an editable (the card's spec textarea) scrolls
			// the field — hijacking it into a pan breaks a function, not a
			// preference. Ctrl/⌘ still zooms from anywhere.
			if (!event.ctrlKey && !event.metaKey) {
				const target = event.target;
				if (
					target instanceof Element &&
					target.closest("textarea, input, select, [contenteditable='true']")
				) {
					return;
				}
			}
			event.preventDefault();
			gestured.current = true;
			const rect = host.getBoundingClientRect();
			setViewport((current) => {
				if (!current) return current;
				if (event.ctrlKey || event.metaKey) {
					// Pinch gestures arrive as ctrl+wheel.
					return zoomAt(
						current,
						event.clientX - rect.left,
						event.clientY - rect.top,
						wheelZoomFactor(event.deltaY, event.deltaMode),
					);
				}
				return { ...current, tx: current.tx - event.deltaX, ty: current.ty - event.deltaY };
			});
		};
		host.addEventListener("wheel", onWheel, { passive: false });
		return () => host.removeEventListener("wheel", onWheel);
	}, []);

	const zoomStep = (k: number) => {
		gestured.current = true;
		const host = hostRef.current;
		if (!host) return;
		const rect = host.getBoundingClientRect();
		setViewport((current) =>
			current ? zoomAt(current, rect.width / 2, rect.height / 2, k) : current,
		);
	};
	const zoomTo = (target: number) => {
		gestured.current = true;
		const host = hostRef.current;
		if (!host) return;
		const rect = host.getBoundingClientRect();
		setViewport((current) =>
			current ? zoomAt(current, rect.width / 2, rect.height / 2, target / current.z) : current,
		);
	};

	const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		// Primary button only: a right-click opens the context menu, the
		// browser then SUPPRESSES the matching pointerup, and the dangling
		// drag panned the canvas on bare mouse moves until the next click.
		if (event.button !== 0) return;
		// Identity, not `closest`: a drag that starts INSIDE a node belongs to
		// the node (text selection in a card, a link click in a mirror).
		if (
			event.target !== hostRef.current &&
			event.target !== gridRef.current &&
			event.target !== layerRef.current
		) {
			return;
		}
		drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {
			// An already-released pointer throws NotFoundError; the drag then
			// simply ends at the host's edge.
		}
	};
	const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		const current = drag.current;
		if (!current || current.id !== event.pointerId) return;
		// Belt for the suppressed-pointerup cases the button guard misses:
		// no buttons held means this drag already ended.
		if (event.buttons === 0) {
			drag.current = null;
			return;
		}
		const dx = event.clientX - current.x;
		const dy = event.clientY - current.y;
		// Under 4px of travel this is a click on the background, not a pan.
		if (!current.moved && Math.hypot(dx, dy) < 4) return;
		current.moved = true;
		gestured.current = true;
		current.x = event.clientX;
		current.y = event.clientY;
		setViewport((value) => (value ? { ...value, tx: value.tx + dx, ty: value.ty + dy } : value));
	};
	const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
		if (drag.current?.id === event.pointerId) drag.current = null;
	};

	// The mirrors' side door: wheel events over an iframe go to ITS document,
	// so `MirrorFrame` forwards ctrl/⌘-wheel here in viewport coordinates and
	// the zoom behaves as if the gesture had landed on the background.
	const gestures = useMemo<CanvasGestures>(
		() => ({
			zoomAtClient: (clientX, clientY, deltaY, deltaMode) => {
				const host = hostRef.current;
				if (!host) return;
				gestured.current = true;
				const rect = host.getBoundingClientRect();
				setViewport((current) =>
					current
						? zoomAt(
								current,
								clientX - rect.left,
								clientY - rect.top,
								wheelZoomFactor(deltaY, deltaMode),
							)
						: current,
				);
			},
		}),
		[],
	);

	const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if (event.target !== hostRef.current) return;
		const pan = (dx: number, dy: number) => {
			gestured.current = true;
			setViewport((value) => (value ? { ...value, tx: value.tx + dx, ty: value.ty + dy } : value));
		};
		switch (event.key) {
			case "ArrowLeft":
				pan(KEY_PAN, 0);
				break;
			case "ArrowRight":
				pan(-KEY_PAN, 0);
				break;
			case "ArrowUp":
				pan(0, KEY_PAN);
				break;
			case "ArrowDown":
				pan(0, -KEY_PAN);
				break;
			case "+":
			case "=":
				zoomStep(1.2);
				break;
			case "-":
				zoomStep(1 / 1.2);
				break;
			case "0":
				gestured.current = false;
				fitRef.current();
				break;
			default:
				return;
		}
		event.preventDefault();
	};

	const z = viewport?.z ?? 1;
	const arrow = `wb-arrow-${markerId}`;

	return (
		<CanvasGesturesContext.Provider value={gestures}>
			<CanvasDetailContext.Provider value={detail}>
				<div
					ref={hostRef}
					// A region, NOT role="application": application mode puts screen
					// readers into pass-through over everything INSIDE — every mirror,
					// chip, note and the card's form would lose browse-mode access.
					// Sighted keyboard users lose nothing: the key handler fires only
					// when the host itself is the target.
					role="region"
					aria-label={label}
					aria-roledescription="lienzo"
					// How the panel hands focus back here after a popover closes —
					// the keys only act when the host itself is focused.
					{...{ [CANVAS_ATTR]: "" }}
					tabIndex={0}
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					onPointerUp={onPointerEnd}
					onPointerCancel={onPointerEnd}
					onKeyDown={onKeyDown}
					className={cx(
						// `clip`, not `hidden`: an overflow:hidden box still scrolls when
						// focus lands past its edge, and that scroll silently desyncs the
						// transform. Clip is unscrollable by anything.
						"relative h-full w-full cursor-grab touch-none select-none [overflow:clip] active:cursor-grabbing",
						"focus-visible:outline-2 focus-visible:outline-sky-400",
						className,
					)}
				>
					{viewport && (
						<>
							<div
								ref={gridRef}
								aria-hidden
								className="absolute inset-0 text-zinc-950/[0.12] transition-opacity duration-200 dark:text-white/10"
								style={{
									backgroundImage: "radial-gradient(currentColor 1px, transparent 1px)",
									// A fixed 32px pitch ON SCREEN: a world-pitch grid becomes a
									// 2.9px moiré wash at a fitted zoom — it was the largest
									// visual object on the canvas, competing with the screens.
									backgroundSize: "32px 32px",
									backgroundPosition: `${viewport.tx}px ${viewport.ty}px`,
									// And it is ground, not figure: gone entirely when you are
									// far enough away that the map is what matters.
									opacity: viewport.z < 0.5 ? 0 : 1,
								}}
							/>
							<div
								ref={layerRef}
								{...{ [ZOOM_ATTR]: String(viewport.z) }}
								className="absolute left-0 top-0 will-change-transform"
								style={
									{
										transform: `translate(${viewport.tx}px, ${viewport.ty}px) scale(${viewport.z})`,
										transformOrigin: "0 0",
										// Chrome counter-scales off this. Written on the same
										// element, in the same paint as the transform — a name
										// above a screen can never lag the screen it names.
										[ZOOM_VAR]: String(viewport.z),
									} as React.CSSProperties
								}
							>
								{nodes
									.filter((node) => node.behind)
									.map((node) => (
										// Sections: painted before the edges and the screens,
										// so a band's tint sits behind everything it holds.
										<div
											key={node.key}
											aria-hidden
											className="pointer-events-none absolute"
											style={{
												left: node.x,
												top: node.y,
												width: node.width,
												height: node.height,
											}}
										>
											{node.element}
										</div>
									))}
								<svg
									aria-hidden
									width="1"
									height="1"
									className="pointer-events-none absolute left-0 top-0 text-zinc-400 dark:text-zinc-500"
									style={{ overflow: "visible" }}
								>
									<defs>
										<marker
											id={arrow}
											viewBox="0 0 10 10"
											refX="8.5"
											refY="5"
											markerWidth="7"
											markerHeight="7"
											orient="auto-start-reverse"
										>
											<path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
										</marker>
									</defs>
									{edges.map((edge) => {
										const at = edgeLabelPoint(edge.from, edge.to, edge.waypoints);
										return (
											<g key={edge.id}>
												<path
													d={edgePath(edge.from, edge.to, edge.waypoints)}
													fill="none"
													stroke="currentColor"
													// Screen px, not world px: at a fitted zoom a 3px
													// world stroke is 0.36px of 12% grey — the
													// connective tissue was the least visible thing on
													// a diagram whose whole subject is connection.
													strokeWidth={1.75 / viewport.z}
													strokeDasharray={
														edge.variant === "dashed"
															? `${8 / viewport.z} ${6 / viewport.z}`
															: undefined
													}
													markerEnd={`url(#${arrow})`}
												/>
												{edge.label && detail === "near" && (
													<text
														// Counter-scaled like every other label, so a «vía»
														// reads at one size at 60% and at 200%. Free here: this
														// component already re-renders on the ticks it reads.
														transform={`translate(${at.x} ${at.y}) scale(${1 / viewport.z})`}
														textAnchor="middle"
														dominantBaseline="middle"
														fontSize={12}
														// The knockout: a fat stroke in the canvas'
														// own background painted UNDER the glyphs
														// interrupts the curve where the words sit.
														stroke={`var(${CANVAS_BG_VAR}, #fafafa)`}
														strokeWidth={5}
														style={{ paintOrder: "stroke" }}
														className="fill-zinc-600 font-medium dark:fill-zinc-300"
													>
														{edge.label}
													</text>
												)}
											</g>
										);
									})}
								</svg>
								{nodes
									.filter((node) => !node.behind)
									.map((node) => (
										<div
											key={node.key}
											// `select-text` undoes the host's `select-none` exactly
											// where selection is wanted — a route, a note, an
											// engine error inside a card. Background drags still
											// never select, because they start outside every node.
											className="absolute select-text"
											style={{
												left: node.x,
												top: node.y,
												width: node.width,
												// Height stays the node's own business (the estimate may
												// run a little short of the real footer), but the
												// intrinsic size lets the browser skip offscreen work.
												// A node that must keep working offscreen opts out:
												// display-locking a capture in flight throttles the
												// very rAF/observer traffic its settling waits on.
												...(node.alwaysRender
													? {}
													: {
															contentVisibility: "auto",
															containIntrinsicSize: `${node.width}px ${node.height}px`,
														}),
											}}
											onContextMenu={
												node.onContextMenu
													? (event) => {
															event.preventDefault();
															node.onContextMenu?.({ x: event.clientX, y: event.clientY });
														}
													: undefined
											}
										>
											{node.element}
										</div>
									))}
								{/* Chrome last and unclipped: `content-visibility` above
							    contains paint to the padding box, and every piece of
							    chrome deliberately sits outside the screen it labels. */}
								{nodes
									.filter((node) => node.chrome)
									.map((node) => (
										<div
											key={`chrome:${node.key}`}
											// Transparent to the pointer, opaque only where chrome
											// actually is: this box is the node's FULL size and
											// paints last, so without this it hit-tests over the
											// screen it labels — swallowing the background drag,
											// the mirrors' connect gesture and the card's own form.
											className="pointer-events-none absolute"
											// The chrome and the screen it names are separate
											// subtrees, so nothing but this associates them for
											// assistive tech.
											role="group"
											aria-label={node.chromeLabel}
											style={
												{
													left: node.x,
													top: node.y,
													width: node.width,
													// The node's real box: chrome anchors to its edges, so
													// `top: 100%` means "under the screen". Without a height
													// every such row stacked back onto the name instead.
													height: node.height,
													// So a label can bound itself to the screen it
													// names: constant-size text over a world-size box
													// otherwise grows over the next node as you zoom out.
													[NODE_WIDTH_VAR]: String(node.width),
												} as React.CSSProperties
											}
										>
											{node.chrome}
										</div>
									))}
							</div>
							<div className="absolute bottom-3 left-3 z-10 flex items-center gap-1 rounded-md border border-zinc-950/10 bg-white/70 p-1 text-zinc-600 shadow-sm backdrop-blur transition-opacity duration-200 hover:bg-white/95 dark:border-white/10 dark:bg-zinc-900/70 dark:text-zinc-300 dark:hover:bg-zinc-900/95">
								{detail === "far" && (
									// The chips are gone at this distance and nothing else
									// would say why.
									<span role="status" className="px-1 text-[11px] text-zinc-500 dark:text-zinc-400">
										Vista de mapa · acércate para ver las páginas y editarlas
									</span>
								)}
								<button
									type="button"
									aria-label="Ajustar el recorrido a la vista"
									onClick={() => {
										gestured.current = false;
										fitRef.current();
									}}
									className="rounded px-2 py-1 text-[11px] font-medium hover:bg-zinc-950/5 dark:hover:bg-white/10"
								>
									Ajustar
								</button>
								<button
									type="button"
									aria-label="Alejar"
									onClick={() => zoomStep(1 / 1.2)}
									className="rounded px-2 py-1 text-[13px] leading-none hover:bg-zinc-950/5 dark:hover:bg-white/10"
								>
									−
								</button>
								<button
									type="button"
									// The visible "45%" belongs IN the name, or voice control
									// users saying what they see match nothing.
									aria-label={`${Math.round(z * 100)}% — volver al 100%`}
									onClick={() => zoomTo(1)}
									className="rounded px-1.5 py-1 font-mono text-[11px] tabular-nums hover:bg-zinc-950/5 dark:hover:bg-white/10"
								>
									{Math.round(z * 100)}%
								</button>
								<button
									type="button"
									aria-label="Acercar"
									onClick={() => zoomStep(1.2)}
									className="rounded px-2 py-1 text-[13px] leading-none hover:bg-zinc-950/5 dark:hover:bg-white/10"
								>
									+
								</button>
							</div>
						</>
					)}
				</div>
			</CanvasDetailContext.Provider>
		</CanvasGesturesContext.Provider>
	);
}

/**
 * Chrome that keeps its size on screen while the canvas zooms — a Figma frame
 * name, in effect.
 *
 * The counter-scale is pure CSS off `ZOOM_VAR`, so a wheel tick costs a style
 * recalculation and not a React render of two dozen mirrors. Outside a canvas
 * the variable is unset and the fallback `1` makes this an ordinary div.
 */
export function CanvasChrome({
	anchor = "top left",
	clamp = false,
	className,
	style,
	children,
}: {
	/** Which corner stays pinned as the counter-scale grows the box. */
	anchor?: "top left" | "bottom left";
	/**
	 * Bound this chrome to its node's width ON SCREEN. Constant-size text over
	 * a world-size box grows past that box as you zoom out, and two names then
	 * overprint each other — a label that truncates says more than two that
	 * collide.
	 */
	clamp?: boolean;
	className?: string;
	style?: React.CSSProperties;
	children: ReactNode;
}) {
	return (
		<div
			className={cx("pointer-events-auto absolute w-max select-text", className)}
			style={{
				transform: `scale(calc(1 / var(${ZOOM_VAR}, 1)))`,
				transformOrigin: anchor,
				...(clamp
					? {
							maxWidth: `max(9rem, calc(var(${NODE_WIDTH_VAR}, 9999) * var(${ZOOM_VAR}, 1) * 1px))`,
						}
					: {}),
				...style,
			}}
		>
			{children}
		</div>
	);
}
