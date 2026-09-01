import { describe, expect, it } from "vitest";
import {
	CTA_MAX_DEPTH,
	semanticCtaOf,
	CTA_MAX_SHARE,
	ctaOf,
	isSemanticCta,
	isStyledCta,
	type CtaCandidate,
} from "./cta";

function node(over: Partial<CtaCandidate> = {}): CtaCandidate {
	return {
		tag: "DIV",
		role: null,
		type: null,
		href: false,
		onclick: false,
		cursor: "auto",
		name: "",
		share: 0.02,
		disabled: false,
		...over,
	};
}

describe("isSemanticCta", () => {
	it("takes an author at their word", () => {
		expect(isSemanticCta(node({ tag: "BUTTON" }))).toBe(true);
		expect(isSemanticCta(node({ tag: "SUMMARY" }))).toBe(true);
		expect(isSemanticCta(node({ tag: "A", href: true }))).toBe(true);
		expect(isSemanticCta(node({ tag: "INPUT", type: "submit" }))).toBe(true);
		expect(isSemanticCta(node({ tag: "INPUT", type: "button" }))).toBe(true);
		expect(isSemanticCta(node({ role: "link" }))).toBe(true);
		expect(isSemanticCta(node({ role: "menuitem" }))).toBe(true);
		expect(isSemanticCta(node({ onclick: true }))).toBe(true);
	});

	it("refuses an anchor with no destination and a field that only accepts", () => {
		// `<a name="top">` is a bookmark, not a link; a text input is not a CTA.
		expect(isSemanticCta(node({ tag: "A", href: false }))).toBe(false);
		expect(isSemanticCta(node({ tag: "INPUT", type: "text" }))).toBe(false);
		expect(isSemanticCta(node({ tag: "P", name: "Un párrafo" }))).toBe(false);
	});

	it("refuses what the page itself has refused", () => {
		// It leads nowhere; offering to author a step for it is a lie.
		expect(isSemanticCta(node({ tag: "BUTTON", disabled: true }))).toBe(false);
		expect(isSemanticCta(node({ tag: "A", href: true, disabled: true }))).toBe(false);
	});

	it("never takes a structural element, whatever it claims", () => {
		expect(isSemanticCta(node({ tag: "BODY", onclick: true }))).toBe(false);
		expect(isSemanticCta(node({ tag: "FORM", role: "button" }))).toBe(false);
	});
});

describe("isStyledCta", () => {
	it("believes a div that the stylesheet calls clickable and that has a name", () => {
		expect(isStyledCta(node({ cursor: "pointer", name: "Ver el plan" }))).toBe(true);
	});

	it("needs BOTH the pointer and the name", () => {
		expect(isStyledCta(node({ cursor: "pointer", name: "   " }))).toBe(false);
		expect(isStyledCta(node({ cursor: "auto", name: "Ver el plan" }))).toBe(false);
	});

	it("refuses the elements that are clickable without activating anything", () => {
		// A label focuses its field; a form of them would be a dozen false CTAs.
		expect(isStyledCta(node({ tag: "LABEL", cursor: "pointer", name: "Recordarme" }))).toBe(false);
		expect(isStyledCta(node({ tag: "TEXTAREA", cursor: "pointer", name: "Notas" }))).toBe(false);
		// …but an author who gave one a role has still answered the question.
		expect(isSemanticCta(node({ tag: "LABEL", role: "button" }))).toBe(true);
		expect(
			isStyledCta(node({ tag: "BUTTON", disabled: true, cursor: "pointer", name: "Enviar" })),
		).toBe(false);
	});

	it("refuses a pointer that covers the screen — that is a wrapper, not a button", () => {
		const wrapper = { cursor: "pointer", name: "Toda la página", share: CTA_MAX_SHARE + 0.01 };
		expect(isStyledCta(node(wrapper))).toBe(false);
		expect(isStyledCta(node({ ...wrapper, share: CTA_MAX_SHARE }))).toBe(true);
	});
});

describe("ctaOf", () => {
	it("prefers the real control over the clickable card around it", () => {
		// The card carries the pointer; the button carries the href and the
		// name a person would recognise.
		const chain = [
			node({ tag: "SPAN", name: "Empezar" }),
			node({ tag: "BUTTON", name: "Empezar" }),
			node({ cursor: "pointer", name: "Tarjeta entera" }),
		];
		expect(ctaOf(chain)?.tag).toBe("BUTTON");
	});

	it("falls back to the styled ancestor when nothing is semantic", () => {
		const chain = [
			node({ tag: "SPAN", name: "29 €" }),
			node({ cursor: "pointer", name: "Plan Pro · 29 €" }),
		];
		expect(ctaOf(chain)?.name).toBe("Plan Pro · 29 €");
	});

	it("stops climbing before it reaches the shell", () => {
		const deep = [
			...Array.from({ length: CTA_MAX_DEPTH }, () => node()),
			node({ tag: "BUTTON", name: "Demasiado lejos" }),
		];
		expect(ctaOf(deep)).toBeNull();
	});

	it("returns null for ordinary prose", () => {
		expect(ctaOf([node({ tag: "P", name: "Los componentes nunca se aíslan." })])).toBeNull();
		expect(ctaOf([])).toBeNull();
	});
});

describe("semanticCtaOf", () => {
	it("reads nothing the cheap pass has to invent", () => {
		// `frame.tsx` runs this over candidates whose cursor/name/share are
		// placeholders, to skip a `getComputedStyle` per ancestor on every
		// `mouseover`. That is only sound while the semantic rule ignores those
		// three fields — so the invariant is pinned here rather than left to
		// hold by luck in the hot path.
		const cheap = node({ tag: "BUTTON", cursor: "auto", name: "", share: 1 });
		const rich = node({ tag: "BUTTON", cursor: "pointer", name: "Empezar", share: 0.02 });
		expect(isSemanticCta(cheap)).toBe(isSemanticCta(rich));
		expect(semanticCtaOf([cheap])).toBe(cheap);
		// And it never answers for something only the styled rule would claim.
		expect(semanticCtaOf([node({ cursor: "pointer", name: "Tarjeta" })])).toBeNull();
	});
});
