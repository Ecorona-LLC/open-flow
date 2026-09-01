"use client";

import { useContext, useEffect, useRef, type ReactNode } from "react";
import { CanvasGesturesContext, EDGE_VAR } from "./canvas-gestures";
import { cx } from "./cx";
import { ctaOf, CTA_MAX_DEPTH, semanticCtaOf, type CtaCandidate } from "./cta";
import { isElement, readProp } from "./dom-realm";
import { PickBox } from "./pick-box";
// A module cycle (frame → pick-highlight → screen-frame → frame), and a safe
// one: every binding is referenced inside a function body, never while the
// modules evaluate. Taken over a second copy of the rect mapping, whose two
// independent derivations are exactly the bug `mapRect`'s doc names.
import { mapPoint, mapRect } from "./pick-highlight";

/**
 * Frame primitives — the only place the workbench paints app surfaces.
 *
 * Two render modes, and the difference matters:
 *
 * - `InlineSurface` renders the component in this document. Fast, and the real
 *   DOM is right there for devtools — but Tailwind breakpoints are *viewport*
 *   based, so a 390px-wide box still shows desktop styles. That is the classic
 *   Storybook lie, and it is why the device presets swap to an iframe instead.
 * - `RouteFrame` renders a real URL in a same-origin iframe at a real device
 *   width, where breakpoints, cookies and data are all truthful.
 *
 * Dark mode is per-frame, not global. Tailwind v4's
 * `@custom-variant dark (&:where(.dark, .dark *))` plus a plain
 * `.dark { --color-… }` block makes a nested `<div class="dark">` a
 * self-contained dark island — which is why this package needs no theme
 * library, and why light and dark can sit side by side in one board.
 */

export function FrameShell({
	label,
	meta,
	children,
	className,
}: {
	label?: ReactNode;
	meta?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cx(
				"overflow-hidden border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900",
				className,
			)}
			// Border, radius and shadow in screen px via `--wb-edge`, so a frame
			// is an OBJECT at 12% and at 200% alike. The old `border rounded-lg
			// shadow-sm` rendered at 0.12px / 0.96px / 0.12px blur when the
			// canvas was fitted — present in the markup, absent on the screen.
			style={{
				borderWidth: `var(${EDGE_VAR}, 1px)`,
				borderStyle: "solid",
				// Capped as a share of the box: the fit is deliberately not
				// floored, so at z = 0.05 an 8-screen-px radius is 160 world px
				// and a phone frame becomes a stadium.
				borderRadius: `min(calc(var(${EDGE_VAR}, 1px) * 8), 6%)`,
				// The weight `shadow-sm` had, in screen pixels. Heavier would be
				// a silent restyle of Componentes and the isolated frame view,
				// which share this shell and were not part of this change.
				boxShadow: `0 calc(var(${EDGE_VAR}, 1px) * 1) calc(var(${EDGE_VAR}, 1px) * 2) rgb(0 0 0 / 0.05)`,
			}}
		>
			{(label || meta) && (
				<div className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 text-[11px] font-medium tracking-wide text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
					<span className="truncate">{label}</span>
					{meta && (
						<span className="truncate font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
							{meta}
						</span>
					)}
				</div>
			)}
			{children}
		</div>
	);
}

/** Render children on the app's own surface, optionally as a dark island. */
export function InlineSurface({
	theme,
	children,
	padded = true,
	editing,
}: {
	theme: "light" | "dark";
	children: ReactNode;
	padded?: boolean;
	/** Same rule as `ScreenFrame`: the screen is pickable, the chrome is not. */
	editing?: boolean;
}) {
	return (
		<div className={cx(theme === "dark" && "dark")}>
			<PickBox enabled={editing} className={cx("bg-background text-foreground", padded && "p-6")}>
				{children}
			</PickBox>
		</div>
	);
}

/**
 * A real URL in a same-origin iframe, at a real device size.
 *
 * Same-origin means the iframe shares the parent's cookies, so auth-gated
 * routes render for whoever is signed in to this browser — that is what lets a
 * flow storyboard show a real signed-in page instead of a mock.
 */
export function RouteFrame({
	src,
	title,
	width,
	height,
	theme,
	frameRef,
	onLoad,
}: {
	src: string;
	title: string;
	width: number;
	height: number;
	/**
	 * When given, the class goes straight onto the frame's `documentElement` —
	 * a real route has no `?theme=` parameter the way a component frame does.
	 * Omit it for frames whose URL already carries the theme.
	 */
	theme?: "light" | "dark";
	frameRef?: (frame: HTMLIFrameElement | null) => void;
	onLoad?: (frame: HTMLIFrameElement) => void;
}) {
	const ref = useRef<HTMLIFrameElement | null>(null);

	useEffect(() => {
		if (theme === undefined) return;
		const frame = ref.current;
		if (!frame) return;
		const apply = () => {
			try {
				frame.contentDocument?.documentElement.classList.toggle("dark", theme === "dark");
			} catch {
				// Cross-origin would throw; these never are.
			}
		};
		apply();
		frame.addEventListener("load", apply);
		// A frame whose `load` fired before this effect ran never hears the
		// event, and one still navigating replaces the document we just marked.
		// Measured: two of four frames stayed light without these re-applies.
		const retries = [300, 1200, 2500].map((delay) => setTimeout(apply, delay));
		return () => {
			frame.removeEventListener("load", apply);
			for (const timer of retries) clearTimeout(timer);
		};
	}, [theme, src]);

	// Natural size only. Measuring and scaling belong to the board that knows
	// how many frames share the space — see `ScreenFrame`. Doing both here is
	// what let three places derive the same number and disagree about it.
	//
	// No `loading="lazy"`: it promised a deferral the boards can never deliver
	// — `fit` zoom exists to put every frame in the viewport at once, so the
	// attribute never once deferred a load. The flow board's capture sweep is
	// the real gate now.
	return (
		<iframe
			ref={(element) => {
				ref.current = element;
				frameRef?.(element);
			}}
			src={src}
			title={title}
			width={width}
			height={height}
			onLoad={(event) => onLoad?.(event.currentTarget)}
			className="border-0 bg-white"
			style={{ width, height }}
		/>
	);
}

/** What a click on a control inside a mirror carries. */
export interface MirrorPick {
	/** Which gesture asked. A right-click means "make this a branch"; the
	 *  panel still decides whether that is legal here. */
	wants: "append" | "fork";
	/** Visible text of the control, collapsed, at most 80 characters. */
	text: string;
	/** The anchor's resolved href — absolute, thanks to the `<base>` the
	 *  serializer injects — or null for a control that is not a link. */
	href: string | null;
	/** Viewport coordinates, already mapped through the scaled frame. */
	rect: { top: number; left: number; width: number; height: number };
}

/**
 * What a person would call this control. One writer, because the string that
 * decides whether something IS a control and the string the popover shows for
 * it are the same question — asked twice, they answered differently for the
 * same element.
 */
function nameOf(element: Element): string {
	const value = element.tagName === "INPUT" ? String(readProp(element, "value") ?? "") : "";
	return (
		value ||
		element.getAttribute("aria-label") ||
		element.getAttribute("title") ||
		element.textContent ||
		""
	);
}

/**
 * Read one element the way `cta.ts` wants it. The DOM lives here; the RULE
 * lives there, so it can be tested against literals.
 *
 * `styled` is the expensive half — `getComputedStyle`, a layout read and a
 * whole-subtree `textContent`. It is skipped on the first pass because
 * `isSemanticCta` reads none of it, and the first pass answers for every
 * `<button>` and `<a href>` on earth. That matters because this runs from a
 * capture-phase `mouseover`: paying it per ancestor per element crossed turned
 * the app's busiest event into a reflow storm inside a display-locked
 * document.
 */
function candidateOf(element: Element, frameArea: number, styled: boolean): CtaCandidate {
	const view = styled ? element.ownerDocument.defaultView : null;
	const rect = styled ? element.getBoundingClientRect() : null;
	return {
		tag: element.tagName.toUpperCase(),
		role: element.getAttribute("role")?.toLowerCase() ?? null,
		type: element.getAttribute("type")?.toLowerCase() ?? null,
		href: element.hasAttribute("href"),
		onclick: element.hasAttribute("onclick"),
		disabled: element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true",
		// Placeholders on the cheap pass. `semanticCtaOf` is what makes that
		// safe — it reads none of these three — where running the whole rule
		// would have asked `isStyledCta` about a cursor and a name we invented.
		cursor: view ? view.getComputedStyle(element).cursor : "auto",
		name: styled ? nameOf(element) : "",
		share: rect && frameArea > 0 ? (rect.width * rect.height) / frameArea : 1,
	};
}

/**
 * A value the listeners can read without being re-armed for it.
 *
 * The arm effect attaches to the iframe's document on load and must NOT re-run
 * on a prop flip — tearing listeners down mid-load is the bug `useInspect`
 * documents. So every prop those listeners consult comes through here. Three
 * hand-rolled copies of this in one file was where the idiom stopped being
 * premature to name.
 */
function useLatest<T>(value: T) {
	const ref = useRef(value);
	useEffect(() => {
		ref.current = value;
	}, [value]);
	return ref;
}

/**
 * A captured snapshot of a route, rendered from `srcdoc` — see `mirror.ts` for
 * why the storyboard shows these instead of live frames.
 *
 * `sandbox` without `allow-scripts` is the second line of defence behind the
 * serializer's stripping: whatever script survives, the browser refuses to run
 * it. `allow-same-origin` stays so the parent can still reach the document —
 * the dark toggle, ⌥E picking and the connect gesture all depend on that.
 */
export function MirrorFrame({
	srcdoc,
	title,
	width,
	height,
	theme,
	connect,
	onMenu,
}: {
	srcdoc: string;
	title: string;
	width: number;
	height: number;
	theme: "light" | "dark";
	/**
	 * Arms "click a control → offer + Añadir pantalla" on this mirror, where
	 * clicks are otherwise dead. `onPick(null)` reports a click that hit no
	 * control, so the board can close an open offer. Held in a ref: re-running
	 * the arm effect on a prop flip would tear iframe listeners down mid-load,
	 * the bug `useInspect` documents.
	 */
	connect?: {
		/**
		 * The panel will ignore a pick right now — a card is open, or a write is
		 * in flight. The gesture must not CLAIM the event then: a suppressed
		 * browser menu with nothing of ours in its place reads as a broken
		 * build, and the screen's own menu (which says «Hay una escritura en
		 * curso») never gets the chance to explain. Dropping `connect` entirely
		 * while busy would be wrong — it also unregisters the click handler that
		 * stops an anchor navigating the mirror back to the live route.
		 */
		busy?: boolean;
		onPick: (pick: MirrorPick | null) => void;
		onHover: (pick: MirrorPick | null) => void;
	};
	/**
	 * A right-click that hit no control, in PARENT viewport coordinates — the
	 * screen's own menu. Separate from `connect` on purpose: the menu is
	 * navigation, and it stays reachable while «Señalar» has the connect
	 * gesture turned off.
	 */
	onMenu?: (at: { x: number; y: number }) => void;
}) {
	const ref = useRef<HTMLIFrameElement | null>(null);
	const latest = useLatest(connect);
	const menuRef = useLatest(onMenu);
	// The canvas this mirror sits on, if any. Held in a ref like `connect`:
	// the arm effect must not re-run on a context flip.
	const gesturesRef = useLatest(useContext(CanvasGesturesContext));

	useEffect(() => {
		const frame = ref.current;
		if (!frame) return;
		// Read once per arm rather than per event — a parent layout read on a
		// capture-phase `mouseover` is exactly the cost this pass removed. The
		// effect re-runs on a size change, so `CTA_MAX_SHARE`'s leash cannot be
		// left measuring against a frame that has resized under it.
		const area = frame.clientWidth * frame.clientHeight;
		// `isElement`, not `instanceof`: targets live in the frame's realm,
		// where the parent's `Element` constructor never matches.
		const controlOf = (target: EventTarget | null): Element | null => {
			if (!isElement(target)) return null;
			// The element and its nearest ancestors, so `ctaOf` can prefer a real
			// control over the clickable card wrapping it.
			const chain: Element[] = [];
			for (
				let node: Element | null = target;
				node && chain.length < CTA_MAX_DEPTH;
				node = node.parentElement
			) {
				chain.push(node);
			}
			// Cheap pass first. It reads attributes only, and it answers for
			// every `<button>` and `<a href>` — which is most of what people
			// navigate with — so the expensive pass usually never runs.
			// `ctaOf` returns an element OF the array it was handed, so its
			// index in that array is the matching element's index in the chain.
			const cheap = chain.map((element) => candidateOf(element, area, false));
			const semantic = semanticCtaOf(cheap);
			if (semantic) return chain[cheap.indexOf(semantic)] ?? null;
			const rich = chain.map((element) => candidateOf(element, area, true));
			const styled = ctaOf(rich);
			return styled ? (chain[rich.indexOf(styled)] ?? null) : null;
		};
		const pickOf = (control: Element, wants: MirrorPick["wants"] = "append"): MirrorPick => {
			const anchor = control.closest("a[href]");
			const text = nameOf(control).trim().replace(/\s+/g, " ").slice(0, 80);
			return {
				wants,
				text,
				// The IDL property, not the attribute: resolved against the
				// injected `<base>`, so a relative href arrives absolute.
				href: anchor ? String(readProp(anchor, "href")) : null,
				rect: mapRect(control, frame),
			};
		};
		const onClick = (event: Event) => {
			// A clicked anchor would navigate the frame to the real route and
			// silently resurrect the live load the mirror exists to avoid.
			const target = event.target;
			if (isElement(target) && target.closest("a[href]")) event.preventDefault();
			const control = controlOf(target);
			latest.current?.onPick(control ? pickOf(control) : null);
		};
		// Deduped by control: `mouseover` fires per element crossed, and a
		// fresh pick per crossing re-rendered the whole panel twice for every
		// child boundary inside one button.
		let hovered: Element | null = null;
		let last: EventTarget | null = null;
		const onOver = (event: Event) => {
			if (!latest.current) return;
			// A repeated crossing of the SAME element costs nothing. It does not
			// help crossing between a button and its span — `mouseover` reports
			// a different target for each — which is what the cheap semantic
			// pass above is for; this only stops the walk re-running when the
			// pointer re-enters an element it just left.
			if (event.target === last) return;
			last = event.target;
			const control = controlOf(event.target);
			if (control === hovered) return;
			hovered = control;
			latest.current.onHover(control ? pickOf(control) : null);
		};
		const onLeave = () => {
			hovered = null;
			last = null;
			latest.current?.onHover(null);
		};
		// Right-click asks for a branch. Left-click keeps whatever the panel
		// judges primary; this is how one screen's «Iniciar sesión» and «Crear
		// cuenta» become two branches without opening a menu.
		//
		// Over a mirror, the browser's own menu is suppressed wherever the
		// board offers one of its own — which, on the board, is everywhere. The
		// mirror is an inert `srcdoc` whose native menu offers little (its
		// "view source" is our serializer's output, its links are dead), and
		// the storyboard owning the whole surface is worth more than that. A
		// LIVE page is never touched: `RouteFrame` arms none of this.
		//
		// Typed `MouseEvent`, not `Event` + an assertion: `DocumentEventMap`
		// already says a `contextmenu` is one, and the assertion would keep
		// type-checking if this were ever also registered for a keydown.
		const onContext = (event: MouseEvent) => {
			// A parked gesture must not CLAIM the event — the panel would drop
			// the pick in silence and the menu that explains why would never
			// open.
			const armed = latest.current && !latest.current.busy ? latest.current : null;
			const control = armed ? controlOf(event.target) : null;
			if (control && armed) {
				event.preventDefault();
				armed.onPick(pickOf(control, "fork"));
				return;
			}
			// Not on a control: the screen itself was asked for its actions.
			// Forwarded in parent coordinates, like the pinch below — the panel
			// draws a `position: fixed` menu and cannot read this document's.
			const open = menuRef.current;
			if (!open) return;
			event.preventDefault();
			open(mapPoint(event.clientX, event.clientY, frame));
		};
		// The canvas' wheel listener never hears a wheel that lands on this
		// document, so the pinch gesture (ctrl/⌘-wheel) is forwarded to it in
		// parent coordinates — and preventDefault also stops the browser
		// page-zooming the whole workbench over a mirror, which it did. A plain
		// wheel stays with the mirror: scrolling a captured page is wanted.
		//
		// Mirrors only. `RouteFrame` is a LIVE page and its events are its own;
		// at most one is mounted, and intercepting a real app's ctrl-wheel
		// (maps, editors, canvases of its own) would be the workbench lying
		// about what the page does.
		const onWheel = (event: WheelEvent) => {
			if (!event.ctrlKey && !event.metaKey) return;
			event.preventDefault();
			const at = mapPoint(event.clientX, event.clientY, frame);
			gesturesRef.current?.zoomAtClient(at.x, at.y, event.deltaY, event.deltaMode);
		};
		const arm = () => {
			try {
				const doc = frame.contentDocument;
				if (!doc) return;
				doc.documentElement.classList.toggle("dark", theme === "dark");
				doc.addEventListener("click", onClick, true);
				doc.addEventListener("mouseover", onOver, true);
				// NOT capture phase: `mouseleave` does not bubble, so a plain
				// listener fires only when the pointer leaves the document —
				// captured, it fired for every element left along the way.
				doc.addEventListener("mouseleave", onLeave);
				// Non-passive on purpose: a wheel listener is passive by default
				// and a passive preventDefault is silently ignored.
				doc.addEventListener("wheel", onWheel, { passive: false });
				doc.addEventListener("contextmenu", onContext, true);
			} catch (error) {
				// Said out loud, unlike the teardown below: a throw here leaves
				// the mirror with NO click, hover, wheel or contextmenu listener
				// — the connect gesture and the screen menu both simply gone,
				// permanently and reproducibly, with nothing to look at.
				console.warn("[workbench] no se pudo armar el espejo", error);
			}
		};
		// `srcdoc` parses asynchronously, so arm now for the document that may
		// already be there and again on `load` for the one replacing it.
		arm();
		frame.addEventListener("load", arm);
		return () => {
			frame.removeEventListener("load", arm);
			try {
				const doc = frame.contentDocument;
				doc?.removeEventListener("click", onClick, true);
				doc?.removeEventListener("mouseover", onOver, true);
				doc?.removeEventListener("mouseleave", onLeave);
				doc?.removeEventListener("wheel", onWheel);
				doc?.removeEventListener("contextmenu", onContext, true);
			} catch {
				// Already torn down.
			}
		};
	}, [theme, srcdoc, width, height]);

	return (
		<iframe
			ref={ref}
			srcDoc={srcdoc}
			title={title}
			sandbox="allow-same-origin"
			data-workbench-mirror=""
			// Out of the tab order: a 12-step board is 24 iframes in split, and
			// tabbing through snapshots is never what anyone meant. Not `inert`
			// — that would also block the pointer events ⌥E picking needs.
			tabIndex={-1}
			width={width}
			height={height}
			className="border-0 bg-white"
			style={{ width, height }}
		/>
	);
}
