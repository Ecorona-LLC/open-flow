"use client";

import { isElement, readProp, readStyle, setStyle } from "./dom-realm";

/**
 * The three fields resolving a hovered element actually needs.
 *
 * Declared structurally so both the full `ComponentEntry` and the overlay's
 * trimmed entry satisfy it — the live path carries a quarter of the catalogue
 * it once did, and nothing here had to change to allow that.
 */
export interface IndexedComponent {
	name: string;
	file: string;
	surface: string | null;
}

/**
 * Resolve a DOM element to a node in the surface map.
 *
 * React attaches a `__reactFiber$…` key to host elements; walking `fiber.return`
 * reaches the nearest component and its name. React 19 removed `_debugSource`,
 * so the *file* comes from the manifest's component list — built from real
 * export declarations — rather than from an internal that may vanish next major.
 *
 * Every read goes through `readProp`, so if a future React reshapes the fiber
 * this degrades to "we know the tag" instead of throwing inside a mouse handler.
 */
export interface ResolvedNode {
	tag: string;
	component: string | null;
	/** Single confident file, or null when the name is ambiguous or unknown. */
	file: string | null;
	/** Every component with that name — more than one means genuinely ambiguous. */
	candidates: IndexedComponent[];
	surface: string | null;
}

const FIBER_PREFIX = "__reactFiber$";

/** An index by component name, built once per manifest rather than per hover. */
export type ComponentIndex = Map<string, IndexedComponent[]>;

export function buildComponentIndex(components: readonly IndexedComponent[]): ComponentIndex {
	const index: ComponentIndex = new Map();
	for (const component of components) {
		const existing = index.get(component.name);
		if (existing) existing.push(component);
		else index.set(component.name, [component]);
	}
	return index;
}

function fiberOf(element: Element): unknown {
	for (const key of Object.keys(element)) {
		if (key.startsWith(FIBER_PREFIX)) return readProp(element, key);
	}
	return null;
}

function nameOfType(type: unknown): string | null {
	if (typeof type === "function") {
		const display = readProp(type, "displayName");
		if (typeof display === "string" && display.length > 0) return display;
		const name = readProp(type, "name");
		return typeof name === "string" && name.length > 0 ? name : null;
	}
	// forwardRef / memo wrap the component in an object — every primitive in a
	// hex-core `ui/` folder takes that shape — as does any Radix wrapper — so
	// missing it would blank out
	// exactly the components people hover most.
	if (typeof type === "object" && type !== null) {
		const display = readProp(type, "displayName");
		if (typeof display === "string" && display.length > 0) return display;
		return nameOfType(readProp(type, "render") ?? readProp(type, "type"));
	}
	return null;
}

/**
 * The nearest component **of this repo** above a host element, or null.
 *
 * It must be ours, not merely capitalized. Measured on a real landing page,
 * hovering the hero headline walks `<h1> › <div> › <section> › <main> ›
 * SegmentViewNode › LayoutRouterContext › InnerLayoutRouter ›
 * RedirectErrorBoundary › …` — every name after the host elements is a Next.js
 * internal, because the hero is a Server Component and has no client fiber at
 * all. Returning the first capitalized name labelled that headline
 * `LayoutRouterContext`.
 *
 * So the walk only accepts a name the manifest knows. Framework internals are
 * not in it and never will be; neither is this package's own UI, which is what
 * keeps the tool from pointing at itself. When nothing of ours is found the
 * answer is null and the caller says `<h1>` — an honest blank beats a confident
 * wrong name.
 */
export function componentNameOf(
	element: Element,
	index: ComponentIndex,
	maxDepth = 24,
): string | null {
	let fiber = fiberOf(element);
	for (let depth = 0; depth < maxDepth && fiber; depth++) {
		const name = nameOfType(readProp(fiber, "type"));
		if (name && index.has(name)) return name;
		fiber = readProp(fiber, "return");
	}
	return null;
}

export function resolveNode(element: Element, index: ComponentIndex): ResolvedNode {
	const component = componentNameOf(element, index);
	const candidates = component ? (index.get(component) ?? []) : [];
	const only = candidates.length === 1 ? candidates[0] : undefined;
	return {
		tag: element.tagName.toLowerCase(),
		component,
		file: only?.file ?? null,
		candidates,
		surface: only?.surface ?? null,
	};
}

/* ------------------------------------------------------------- highlights */

const LIT = "2px solid rgb(251 191 36)";
const SCAN_LIMIT = 600;

/**
 * Outline every element rendered by the same component, so the blast radius is
 * visible before you click.
 *
 * Inline styles rather than a stylesheet: the same code has to work inside a
 * flow iframe's document, and injecting a `<style>` into each of those is more
 * moving parts for the same effect.
 */
export function lightSiblings(
	root: Document | Element,
	component: string,
	index: ComponentIndex,
): () => void {
	// Restore what was there rather than deleting: `removeProperty` on cleanup
	// would strip an inline outline the page had set itself.
	const touched: Array<{ element: Element; outline: string; offset: string }> = [];
	const all = root.querySelectorAll("*");
	const limit = Math.min(all.length, SCAN_LIMIT);

	for (let position = 0; position < limit; position++) {
		const element = all[position];
		if (!isElement(element)) continue;
		if (componentNameOf(element, index, 6) !== component) continue;
		touched.push({
			element,
			outline: readStyle(element, "outline"),
			offset: readStyle(element, "outlineOffset"),
		});
		setStyle(element, "outline", LIT);
		setStyle(element, "outline-offset", "1px");
	}

	if (all.length > SCAN_LIMIT) {
		// Say so rather than let a truncated highlight read as "that's all of
		// them" — the whole promise here is a visible blast radius.
		console.info(
			`[workbench] ${all.length} elementos en el documento; sólo se revisaron los ` +
				`primeros ${SCAN_LIMIT} para resaltar ${component}.`,
		);
	}

	return () => {
		for (const { element, outline, offset } of touched) {
			setStyle(element, "outline", outline);
			setStyle(element, "outline-offset", offset);
		}
	};
}
