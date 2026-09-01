/**
 * What counts as a call to action inside a mirrored screen.
 *
 * The storyboard's whole authoring gesture is "click the thing that leads
 * somewhere", so this decides which things are clickable at all. It used to be
 * one selector — `a[href], button, [role="button"], input[type="submit"]` —
 * which is a fair description of 2005 and a poor one of a real app: a clickable
 * card, a `<div>` with an onClick, a custom widget, the row of a table that
 * navigates. All invisible to the gesture, all exactly what people navigate
 * with.
 *
 * Two steps, in order. Semantics first, because an author who wrote `<button>`
 * or `role="link"` has already answered the question. Then the page's own
 * claim: an element whose computed `cursor` is `pointer` and which has an
 * accessible name is a control, whatever it is made of. That reads the
 * intention a stylesheet already states instead of guessing at class names.
 *
 * The heuristic needs a leash, which is the only interesting part. A page that
 * sets `cursor: pointer` on a wrapper — or on `body` — would otherwise make the
 * whole screen one enormous control, and every hover would highlight
 * everything. So a heuristic match is refused when it covers more than half the
 * frame, and the structural elements are never candidates.
 *
 * Pure over a tiny DOM-shaped interface rather than over `Element`, so the
 * rules are testable against literals; `frame.tsx` supplies the real nodes.
 */

/** What the rule needs to know about one element. */
export interface CtaCandidate {
	tag: string;
	/** `role`, lowercased, or null. */
	role: string | null;
	/** `type` for inputs, lowercased, or null. */
	type: string | null;
	/** Whether it carries an `href`. */
	href: boolean;
	/** Whether it carries an inline `onclick`. */
	onclick: boolean;
	/** Computed `cursor`. */
	cursor: string;
	/** Text, `aria-label` or `title` — anything a person could read as a name. */
	name: string;
	/** Its area as a share of the frame, 0–1. */
	share: number;
	/** Refused by the page itself — the `disabled` attribute or `aria-disabled`.
	 *  A half-filled form's submit button is the most common thing on a
	 *  captured mirror, and it leads nowhere. */
	disabled: boolean;
}

/** Roles that mean "activating me does something". */
const ROLES = new Set(["button", "link", "menuitem", "menuitemcheckbox", "tab", "option"]);
/** Tags that are controls by their own definition. */
const TAGS = new Set(["BUTTON", "SUMMARY", "SELECT"]);
/** `<input>` types that act rather than accept. */
const INPUTS = new Set(["submit", "button", "reset", "image"]);
/** Never a control, however they are styled — matching one means matching the
 *  whole screen, which is the same as matching nothing. */
const STRUCTURE = new Set(["HTML", "BODY", "MAIN", "HEADER", "FOOTER", "NAV", "SECTION", "FORM"]);
/** Clickable by definition, activating by nothing. A `<label>` gets
 *  `cursor: pointer` from virtually every reset and always has a name, so a
 *  settings page becomes a wall of false CTAs — the heuristic's densest
 *  false-positive class, at the opposite end of the scale from the wrapper
 *  `CTA_MAX_SHARE` refuses. Checked in the styled pass only, so a
 *  `<label role="button">` still resolves semantically. */
const NEVER_STYLED = new Set(["LABEL", "OPTION", "INPUT", "TEXTAREA", "SELECT"]);

/**
 * The largest share of the frame a `cursor: pointer` element may cover and
 * still be believed. Above this it is a page wrapper wearing a pointer, not a
 * button.
 */
export const CTA_MAX_SHARE = 0.5;

/** How many elements the walk considers, the target itself included — so four
 *  ancestors. Deep enough for an icon inside a span inside a card, shallow
 *  enough never to reach the shell. */
export const CTA_MAX_DEPTH = 5;

/** Whether an element is a control by what it IS, not by how it looks. */
export function isSemanticCta(node: CtaCandidate): boolean {
	if (node.disabled) return false;
	if (STRUCTURE.has(node.tag)) return false;
	if (node.tag === "A") return node.href;
	if (TAGS.has(node.tag)) return true;
	if (node.tag === "INPUT") return node.type !== null && INPUTS.has(node.type);
	if (node.role !== null && ROLES.has(node.role)) return true;
	return node.onclick;
}

/** Whether the page itself says this is clickable — and is small enough to be
 *  believed when it does. */
export function isStyledCta(node: CtaCandidate): boolean {
	if (node.disabled) return false;
	if (STRUCTURE.has(node.tag) || NEVER_STYLED.has(node.tag)) return false;
	if (node.cursor !== "pointer") return false;
	if (node.name.trim().length === 0) return false;
	return node.share <= CTA_MAX_SHARE;
}

/**
 * The control for a picked element, given it and its ancestors nearest-first.
 *
 * Semantics win over styling across the WHOLE chain before styling is
 * considered at all: a `cursor: pointer` card wrapping a real `<button>`
 * should resolve to the button, which is the thing that carries the href and
 * the name a person would recognise.
 */
export function ctaOf(chain: readonly CtaCandidate[]): CtaCandidate | null {
	const near = chain.slice(0, CTA_MAX_DEPTH);
	return semanticCtaOf(near) ?? near.find(isStyledCta) ?? null;
}

/**
 * `ctaOf`'s first clause alone, for a caller that has not paid for the styled
 * fields yet.
 *
 * Named rather than left to `ctaOf`, because a two-pass caller that runs the
 * whole rule over placeholder values is asking `isStyledCta` about a `cursor`
 * and a `name` it invented. That is correct today only because the
 * placeholders happen to fail it — and the moment `isSemanticCta` consults one
 * of those fields, a cheap pass would answer differently from the walk it is
 * standing in for, silently, on the hottest handler in the package.
 */
export function semanticCtaOf(chain: readonly CtaCandidate[]): CtaCandidate | null {
	return chain.slice(0, CTA_MAX_DEPTH).find(isSemanticCta) ?? null;
}
