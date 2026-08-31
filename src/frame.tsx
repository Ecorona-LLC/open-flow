"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "./cx";
import { isElement, readProp } from "./dom-realm";
import { PickBox } from "./pick-box";
// A module cycle (frame → pick-highlight → screen-frame → frame), and a safe
// one: every binding is referenced inside a function body, never while the
// modules evaluate. Taken over a second copy of the rect mapping, whose two
// independent derivations are exactly the bug `mapRect`'s doc names.
import { mapRect } from "./pick-highlight";

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
				"overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-sm",
				"dark:border-zinc-700 dark:bg-zinc-900",
				className,
			)}
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

/** What a click on an actionable element inside a mirror carries. */
export interface MirrorPick {
	/** Visible text of the control, collapsed, at most 80 characters. */
	text: string;
	/** The anchor's resolved href — absolute, thanks to the `<base>` the
	 *  serializer injects — or null for a control that is not a link. */
	href: string | null;
	/** Viewport coordinates, already mapped through the scaled frame. */
	rect: { top: number; left: number; width: number; height: number };
}

/** What counts as "a control that leads somewhere" inside a mirror. */
export const ACTIONABLE = 'a[href], button, [role="button"], input[type="submit"]';

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
		onPick: (pick: MirrorPick | null) => void;
		onHover: (pick: MirrorPick | null) => void;
	};
}) {
	const ref = useRef<HTMLIFrameElement | null>(null);
	const latest = useRef(connect);
	useEffect(() => {
		latest.current = connect;
	}, [connect]);

	useEffect(() => {
		const frame = ref.current;
		if (!frame) return;
		// `isElement`, not `instanceof`: targets live in the frame's realm,
		// where the parent's `Element` constructor never matches.
		const controlOf = (target: EventTarget | null): Element | null => {
			if (!isElement(target)) return null;
			return target.closest(ACTIONABLE);
		};
		const pickOf = (control: Element): MirrorPick => {
			const anchor = control.closest("a[href]");
			const value = control.tagName === "INPUT" ? String(readProp(control, "value") ?? "") : "";
			const text = (value || control.textContent || control.getAttribute("aria-label") || "")
				.trim()
				.replace(/\s+/g, " ")
				.slice(0, 80);
			return {
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
		const onOver = (event: Event) => {
			if (!latest.current) return;
			const control = controlOf(event.target);
			if (control === hovered) return;
			hovered = control;
			latest.current.onHover(control ? pickOf(control) : null);
		};
		const onLeave = () => {
			hovered = null;
			latest.current?.onHover(null);
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
			} catch {
				// Sandbox misconfiguration would throw; nothing to arm then.
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
			} catch {
				// Already torn down.
			}
		};
	}, [theme, srcdoc]);

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
