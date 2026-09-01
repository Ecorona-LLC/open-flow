/**
 * A screen's shape, without the screen.
 *
 * The canvas used to draw ten real pages at one-eighth linear size: a 16px
 * line of body text lands on 1.9 device pixels, and an iframe rasterises near
 * 1:1 before the viewport transform minifies it, so what you got was mush. No
 * amount of styling fixes a page drawn eight times too small.
 *
 * So at a distance the canvas stops drawing the page and draws this instead —
 * the forty biggest boxes the settled document actually laid out, normalised
 * to the viewport, with a hint of what each one was. It reads as the page
 * (that IS the header, that IS the sidebar, those ARE table rows), it is a few
 * hundred bytes beside a two-megabyte `srcdoc`, and it is vector, so it is
 * sharp at every zoom.
 *
 * Measured from the LIVE document during the capture that was happening
 * anyway, which is the only moment the real geometry exists: the mirror is
 * inert (`sandbox` without `allow-scripts`) and could never be asked later.
 *
 * Pure and DOM-shaped rather than DOM-dependent — `sketchOf` takes the boxes,
 * so a test can hand it literals instead of a browser.
 */

/** What a box was, so the sketch can weight it. Coarse on purpose: three
 *  kinds is enough to read a layout and cheap enough to guess reliably. */
export type SketchKind = "text" | "media" | "surface";

/** One box, normalised 0–1 against the viewport it was measured in. */
export interface SketchBox {
	x: number;
	y: number;
	w: number;
	h: number;
	kind: SketchKind;
}

export interface Sketch {
	/** The viewport these boxes were measured in. Kept because the boxes are
	 *  normalised against it and a reader of a stored sketch otherwise cannot
	 *  tell what shape it came from. */
	width: number;
	height: number;
	boxes: SketchBox[];
}

/** Beyond this the drawing stops reading as a layout and starts reading as
 *  noise — and every box costs an SVG node on every canvas paint. */
export const SKETCH_MAX_BOXES = 40;

/** A box smaller than this share of the viewport's area is detail, not shape. */
const MIN_AREA_SHARE = 0.0008;

/** Tags whose box is worth drawing even when something else overlaps it. */
const MEDIA = new Set(["IMG", "SVG", "VIDEO", "CANVAS", "PICTURE"]);
const TEXTUAL = new Set([
	"P",
	"H1",
	"H2",
	"H3",
	"H4",
	"H5",
	"H6",
	"SPAN",
	"A",
	"LI",
	"LABEL",
	"BUTTON",
	"TD",
	"TH",
	"STRONG",
	"EM",
	"CODE",
	"SMALL",
]);

/** What `sketchOf` needs to know about one element. */
export interface SketchInput {
	tag: string;
	x: number;
	y: number;
	w: number;
	h: number;
	/** Whether the element has text of its own (not just through children). */
	text: boolean;
}

function kindOf(input: SketchInput): SketchKind {
	if (MEDIA.has(input.tag)) return "media";
	if (input.text && TEXTUAL.has(input.tag)) return "text";
	return "surface";
}

/**
 * The boxes worth drawing, biggest first, capped.
 *
 * Biggest-first is what makes it read: the page's structure is its large
 * boxes, and the cap then spends itself on the ones that carry the layout
 * rather than on the last leaf of a deep tree. Text is kept at a smaller
 * threshold than surfaces — a heading is small and says more than the div
 * around it.
 */
export function sketchOf(
	viewport: { width: number; height: number },
	inputs: readonly SketchInput[],
	max: number = SKETCH_MAX_BOXES,
): Sketch {
	const area = viewport.width * viewport.height;
	if (area <= 0) return { width: viewport.width, height: viewport.height, boxes: [] };

	const kept = inputs
		.filter((input) => {
			if (input.w <= 0 || input.h <= 0) return false;
			// Off-screen and below-the-fold boxes are not what the frame shows.
			if (input.x >= viewport.width || input.y >= viewport.height) return false;
			if (input.x + input.w <= 0 || input.y + input.h <= 0) return false;
			const share = (input.w * input.h) / area;
			const kind = kindOf(input);
			return share >= (kind === "surface" ? MIN_AREA_SHARE * 4 : MIN_AREA_SHARE);
		})
		.sort((a, b) => b.w * b.h - a.w * a.h);

	// `body > #__next > div > div > main` all measure the same box. Kept, they
	// spend five of forty slots on one rectangle drawn five times — darker, and
	// no more informative. Biggest-first means the survivor is the outermost.
	const distinct: SketchInput[] = [];
	for (const input of kept) {
		const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(2, viewport.width * 0.01);
		const duplicate = distinct.some(
			(seen) =>
				near(seen.x, input.x) &&
				near(seen.y, input.y) &&
				near(seen.w, input.w) &&
				near(seen.h, input.h),
		);
		if (!duplicate) distinct.push(input);
		if (distinct.length >= max) break;
	}

	const clamp = (value: number) => Math.min(1, Math.max(0, value));
	return {
		width: viewport.width,
		height: viewport.height,
		boxes: distinct.map((input) => ({
			x: clamp(input.x / viewport.width),
			y: clamp(input.y / viewport.height),
			w: clamp(input.w / viewport.width),
			h: clamp(input.h / viewport.height),
			kind: kindOf(input),
		})),
	};
}

/**
 * Walk a settled document into `sketchOf`'s input.
 *
 * Deliberately shallow in what it asks of each element: one `getBoundingClientRect`
 * and the tag. A second pass over a big page is the cost, paid once per capture,
 * on a document that has just been declared quiet.
 */
export function readSketch(doc: Document, viewport: { width: number; height: number }): Sketch {
	const body = doc.body;
	if (!body) return { width: viewport.width, height: viewport.height, boxes: [] };
	const inputs: SketchInput[] = [];
	for (const element of Array.from(body.querySelectorAll("*"))) {
		const rect = element.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) continue;
		// Its OWN text, not its descendants': otherwise <body> is "text".
		let text = false;
		for (const node of Array.from(element.childNodes)) {
			if (node.nodeType === 3 && (node.textContent ?? "").trim().length > 0) {
				text = true;
				break;
			}
		}
		inputs.push({
			tag: element.tagName.toUpperCase(),
			x: rect.left,
			y: rect.top,
			w: rect.width,
			h: rect.height,
			text,
		});
	}
	return sketchOf(viewport, inputs);
}
