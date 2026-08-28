"use client";

import { useEffect, useRef } from "react";
import { isElement, readProp } from "./dom-realm";
import {
	lightSiblings,
	resolveNode,
	type ComponentIndex,
	type ResolvedNode,
} from "./hover-inspect";
import { mapRect, type PickTarget } from "./pick-highlight";
import { BOX_ATTR } from "./pick-box";
import { reportRuntimeError } from "./runtime-errors";
import type { Pin } from "./pin";

/**
 * Edit mode — hovering to understand, clicking to pin.
 *
 * Hover resolves the element to a node in the surface map and lights every other
 * element the same component rendered, so the blast radius is visible before you
 * commit to anything. Clicking captures that node into a pin: a pin is a
 * coordinate in the codebase, not a description of one.
 *
 * Picking is confined to regions marked `data-workbench-box` — the frame
 * content, never the workbench's own chrome around it. Without that limit the
 * panel's section headings, source paths and descriptions are all "pickable",
 * and you end up filing a ticket against the tool's own label.
 *
 * Clicks are taken in the **capture** phase and cancelled, so pinning a button
 * pins it rather than pressing it. Flow frames are same-origin iframes, so the
 * same listeners attach to `contentDocument` — re-attached on every `load`,
 * which covers device-preset switches and "Recargar cuadros". The frames also
 * get `error` / `unhandledrejection` listeners while we are in there: knowing
 * *where* something crashed is the other half of this tool's job.
 */
const MAX_TEXT = 80;

/**
 * Inside a box? Elements in a same-origin iframe have no box of their own — the
 * frame itself sits in one, and its whole document is app content.
 */
function inBox(target: Element, inFrame: boolean): boolean {
	return inFrame || target.closest(`[${BOX_ATTR}]`) !== null;
}

function describe(element: Element): Pin["element"] {
	const classes = typeof element.className === "string" ? element.className : "";
	const path: string[] = [];
	let node: Element | null = element;
	for (let depth = 0; depth < 4 && node && node.tagName !== "BODY"; depth++) {
		const own = typeof node.className === "string" ? (node.className.split(/\s+/)[0] ?? "") : "";
		path.unshift(own ? `${node.tagName.toLowerCase()}.${own}` : node.tagName.toLowerCase());
		node = node.parentElement;
	}
	return {
		tag: element.tagName.toLowerCase(),
		classes: classes.trim().split(/\s+/).slice(0, 8).join(" "),
		text: (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_TEXT),
		path: path.join(" > "),
	};
}

function toPinNode(resolved: ResolvedNode): Pin["node"] {
	if (!resolved.component) return null;
	return { component: resolved.component, file: resolved.file, surface: resolved.surface };
}

/**
 * Attach inspection to a container and to any same-origin iframes inside it.
 * The caller owns the pin list and the hover state.
 */
export function useInspect(
	enabled: boolean,
	/**
	 * Resolved at attach time, not at render time. A ref was not enough: on a
	 * real route the overlay has to listen on `document.body`, because the
	 * elements being picked are the *page*, not the overlay's own wrapper —
	 * with a ref it listened to its own pill and nothing on the page ever
	 * resolved.
	 */
	getRoot: () => HTMLElement | null,
	index: ComponentIndex,
	callbacks: {
		onPin: (pin: Pick<Pin, "element" | "node">) => void;
		onHover: (target: PickTarget | null) => void;
	},
	/**
	 * Change to force a re-attach. Iframes are instrumented once per attach, so
	 * any frame mounting later — a lazily-suspended component, a different flow,
	 * a device preset switch — gets no listeners until this changes.
	 */
	resetKey: string | number = 0,
) {
	// Keep callbacks in a ref so re-attaching isn't tied to their identity —
	// re-running the attach effect on every render would tear down iframe
	// listeners mid-load and drop events. Written in an effect, not during
	// render: a render-phase ref write is a bug waiting to happen.
	const latest = useRef(callbacks);
	useEffect(() => {
		latest.current = callbacks;
	}, [callbacks]);

	const indexRef = useRef(index);
	useEffect(() => {
		indexRef.current = index;
	}, [index]);

	useEffect(() => {
		if (!enabled) return;
		const container = getRoot();
		if (!container) return;

		let lit: (() => void) | null = null;
		let litComponent: string | null = null;

		const clearLight = () => {
			lit?.();
			lit = null;
			litComponent = null;
		};

		const onClick = (event: Event, inFrame: boolean) => {
			const target = event.target;
			if (!isElement(target)) return;
			if (!inBox(target, inFrame)) return;
			event.preventDefault();
			event.stopPropagation();
			const resolved = resolveNode(target, indexRef.current);
			latest.current.onPin({ element: describe(target), node: toPinNode(resolved) });
		};

		const onOver = (event: Event, frame: HTMLIFrameElement | null) => {
			const target = event.target;
			if (!isElement(target)) return;
			if (!inBox(target, frame !== null)) {
				latest.current.onHover(null);
				clearLight();
				return;
			}
			const resolved = resolveNode(target, indexRef.current);
			// The rect is mapped through the frame: flow iframes render at a
			// device width and are scaled down, so a raw rect from inside one
			// would draw the outline in the wrong place at the wrong size.
			latest.current.onHover({ rect: mapRect(target, frame), node: resolved });

			// Only re-light when the component actually changed: relighting on
			// every mousemove would scan hundreds of nodes per frame.
			if (resolved.component === litComponent) return;
			clearLight();
			if (resolved.component) {
				litComponent = resolved.component;
				lit = lightSiblings(target.ownerDocument, resolved.component, indexRef.current);
			}
		};

		const onLeave = () => {
			latest.current.onHover(null);
			clearLight();
		};

		const detachers: Array<() => void> = [];
		const attachTo = (
			root: Document | HTMLElement,
			route: string | null,
			frame: HTMLIFrameElement | null,
		) => {
			const over = (event: Event) => onOver(event, frame);
			const click = (event: Event) => onClick(event, frame !== null);
			root.addEventListener("click", click, true);
			root.addEventListener("mouseover", over, true);
			root.addEventListener("mouseleave", onLeave, true);
			detachers.push(() => {
				root.removeEventListener("click", click, true);
				root.removeEventListener("mouseover", over, true);
				root.removeEventListener("mouseleave", onLeave, true);
			});

			if (route !== null) {
				const onError = (event: Event) => {
					// `readProp`, not `instanceof ErrorEvent`: the event comes
					// from the frame's realm, where the parent's constructor
					// never matches — every error read as an uncaptured
					// rejection with no message.
					const message = String(readProp(event, "message") ?? "Promesa rechazada sin capturar");
					reportRuntimeError({ message, route, component: null, file: null });
				};
				// The frame's WINDOW, not its document: `error` and
				// `unhandledrejection` dispatch at the window, so a listener on
				// the document is not on the propagation path and never fired.
				// `readProp`, not `root instanceof Document`: the document comes
				// from the frame's realm, where the parent's constructor never
				// matches — the first version of this fix re-introduced the very
				// bug it was fixing and the listener landed on the document again.
				const defaultView = readProp(root, "defaultView");
				const frameWindow =
					defaultView && typeof (defaultView as Window).addEventListener === "function"
						? (defaultView as Window)
						: null;
				const errorTarget: Document | HTMLElement | Window = frameWindow ?? root;
				errorTarget.addEventListener("error", onError, true);
				errorTarget.addEventListener("unhandledrejection", onError, true);
				detachers.push(() => {
					errorTarget.removeEventListener("error", onError, true);
					errorTarget.removeEventListener("unhandledrejection", onError, true);
				});
			}
		};

		attachTo(container, null, null);

		// Same-origin frames: reach straight into the document. Without this,
		// flows — which are iframes and nothing else — could not be inspected.
		for (const frame of Array.from(container.querySelectorAll("iframe"))) {
			const attach = () => {
				try {
					const doc = frame.contentDocument;
					if (!doc) return;
					attachTo(doc, frame.getAttribute("src"), frame);
					doc.body?.style.setProperty("cursor", "crosshair");
					// Paired teardown: the top document already removes its own
					// cursor on cleanup, and without this every frame keeps a
					// crosshair long after edit mode is off.
					detachers.push(() => doc.body?.style.removeProperty("cursor"));
				} catch {
					// A cross-origin frame would throw; nothing to inspect there.
				}
			};
			attach();
			frame.addEventListener("load", attach);
			detachers.push(() => frame.removeEventListener("load", attach));
		}

		return () => {
			clearLight();
			for (const detach of detachers) detach();
		};
	}, [enabled, getRoot, resetKey]);
}
