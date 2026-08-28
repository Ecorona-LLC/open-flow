/**
 * Touching the DOM across realm boundaries.
 *
 * Flows render real routes in same-origin iframes, and each iframe document has
 * its own copy of every constructor. So `value instanceof Element` is **false**
 * for every element inside one, and `value instanceof HTMLElement` likewise.
 * Edit mode silently did nothing inside flow frames, device previews and the
 * isolated viewer for exactly that reason, for as long as it used `instanceof`.
 *
 * `nodeType === 1` is the same answer in any realm. So is reading `.style`
 * through `Reflect.get` rather than narrowing to `HTMLElement` first.
 *
 * These two helpers were written twice, in two modules, for the same reason.
 * They live here once.
 */

/** Realm-agnostic "is this an element?". */
export function isElement(value: unknown): value is Element {
	if (typeof value !== "object" || value === null) return false;
	return Reflect.get(value, "nodeType") === 1;
}

/**
 * Read a property off anything, including a function.
 *
 * Functions too, not just objects: a plain function component's name lives on
 * the function itself. Restricting this to `typeof === "object"` made
 * `forwardRef` primitives (whose type IS an object) resolve while every plain
 * function component silently returned null and fell back to the bare tag —
 * which is why `Button` worked and `LandingHero` never did.
 */
export function readProp(value: unknown, key: string): unknown {
	if (value === null || (typeof value !== "object" && typeof value !== "function")) {
		return undefined;
	}
	try {
		return Reflect.get(value, key);
	} catch {
		// A getter that throws is not worth taking the whole mouse handler down.
		return undefined;
	}
}

/**
 * An element's inline style, as an opaque object.
 *
 * Not narrowed to `CSSStyleDeclaration` with an assertion: the whole reason
 * this module exists is that the value came from another realm, so asserting a
 * type onto it would be claiming exactly the thing we cannot check. It stays
 * `object` and every use goes through `Reflect`.
 */
function styleOf(element: Element): object | null {
	const style = readProp(element, "style");
	if (!style || typeof style !== "object" || !("setProperty" in style)) return null;
	return style;
}

export function setStyle(element: Element, property: string, value: string): void {
	const style = styleOf(element);
	if (!style) return;
	const setProperty = readProp(style, "setProperty");
	if (typeof setProperty === "function") {
		Reflect.apply(setProperty, style, [property, value]);
	}
}

export function readStyle(element: Element, property: string): string {
	const style = styleOf(element);
	return style === null ? "" : String(readProp(style, property) ?? "");
}
