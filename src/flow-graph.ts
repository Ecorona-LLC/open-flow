import { laneKey, type Lane, type StepNode } from "./flow-layout";
import { FRAME_CHROME } from "./screen-frame";

/**
 * The storyboard as a graph: nodes with boxes, edges with labels, bands with
 * a deterministic layered layout — the canvas draws exactly what this module
 * computes.
 *
 * Pure and DOM-free for the reason `flow-layout.ts` gives: positions must be
 * testable against a manifest literal. Node boxes are ESTIMATED, never
 * measured — a ResizeObserver-fed layout is impure, re-lays on every chip
 * wrap, and loops paint→measure→layout→paint over two dozen iframes. On an
 * infinite surface an underestimate overlaps, so the gaps carry the slack.
 *
 * `StepNode.key` is the node id. The frames ledger, the composer and
 * `useInspect` all speak it already, so the canvas changes how screens are
 * PLACED and nothing about how they are captured or grown.
 */

export interface Box {
	width: number;
	height: number;
}

export type GraphNode =
	| { kind: "step"; key: string; node: StepNode; box: Box; anchorY: number }
	| { kind: "card"; key: string; laneKey: string; fork: boolean; box: Box; anchorY: number };

export interface GraphEdge {
	id: string;
	from: string;
	to: string;
	/** The «vía» text (a step edge), or the branch label (a fork edge). */
	label: string | null;
	kind: "step" | "fork" | "tail";
}

/** One band of the layout: the trunk, a branch, or the fork card being authored. */
export interface GraphBand {
	laneKey: string;
	/** What a person should read above this band. */
	label: string | null;
	/** The trunk node this band fans out from, or null (trunk, orphan). */
	forkKey: string | null;
	/** A branch whose `from` the shown trunk does not have — drawn, said, unconnected. */
	orphan: boolean;
	nodeKeys: string[];
}

export interface FlowGraph {
	nodes: GraphNode[];
	edges: GraphEdge[];
	bands: GraphBand[];
}

/* ------------------------------------------------- estimation constants */
/* One owner for every number the canvas and the graph must agree on. A box is
 * now EXACTLY the screen plus the shell's real padding: names, chips and links
 * became constant-size chrome drawn outside the box (see `flow-canvas.tsx`'s
 * chrome pass), so the layout no longer estimates text it does not draw. */

/** Horizontal room for the edge curve and a «vía» label set at world size. */
export const NODE_GAP_X = 140;
/**
 * Vertical gap between rows. Wide enough to be a GUTTER: a packed row means a
 * fork edge must travel sideways past other bands, and it does that here
 * rather than over somebody's screen.
 */
export const NODE_GAP_Y = 120;
/** ~0.55em per glyph at the canvas' 28px label type. */
const LABEL_GLYPH = 15;
/**
 * World room above a band for its section label. Generous on purpose: the
 * label and the frame names below it are BOTH constant-size, so the only
 * thing keeping them apart as you zoom out is the world gap between them.
 */
export const SECTION_LIFT = 120;
/** Breathing room a section keeps around the screens it holds. */
export const SECTION_PAD = 28;
/**
 * The shape the layout aims for: a landscape rectangle, near enough to a
 * canvas panel that the fit uses both axes.
 *
 * Packing rightward without limit turned a ten-screen flow into an 11 000 ×
 * 2 200 ribbon — 5:1 inside a 1.5:1 window, so the fit was width-bound at
 * 12 % and two-thirds of the surface stayed empty. Stacking without limit is
 * the same mistake rotated. So a band joins a row only when joining leaves
 * the graph closer to this than wrapping would.
 */
export const TARGET_ASPECT = 1.6;

/** The band key of the fork card being authored — never a real lane key. */
export const FORK_CARD_BAND = "card:fork";

/** A lane's open-card node key. One owner: the board indexes positions by
 *  these, and a format that lived in two files would drift silently — a
 *  missed lookup draws nothing rather than throwing. */
export function tailKeyOf(laneKey: string): string {
	return `card:${laneKey}`;
}

/** The fork card's node key, by the flat index of the step it leaves from. */
export function forkCardKey(flat: number): string {
	return `card:fork:${flat}`;
}

/**
 * The gap an edge needs: at least `NODE_GAP_X`, widened for its label. The
 * label sits mid-gap at world size between OPAQUE screens, so «Continuar con
 * Google» in a fixed gap would paint under both neighbours.
 */
export function labelGap(label: string | null): number {
	if (!label) return NODE_GAP_X;
	return Math.max(NODE_GAP_X, label.length * LABEL_GLYPH + 40);
}

/**
 * The box a screen occupies: the screen itself plus the shell's padding, and
 * nothing else. Shared by steps and cards — one function does this sum, or the
 * graph reserves a different box from the one the cell draws.
 *
 * `FrameShell`'s 1px border is knowingly not counted: 2px against a 120px gap
 * is slack the gaps already carry, and a constant that had to track a border
 * width would be a third thing to keep in step.
 */
export function cardBoxOf(viewport: { width: number; height: number }): Box {
	return { width: viewport.width + FRAME_CHROME, height: viewport.height + FRAME_CHROME };
}

function stepBoxOf(node: StepNode): { box: Box; anchorY: number } {
	const box = cardBoxOf(node.viewport);
	// Edges aim at the screen's vertical centre, which is the box's centre now
	// that the box is only the screen. Kept as its own field because mixed
	// viewports mean no caller may assume `height / 2` of anything else.
	return { box, anchorY: box.height / 2 };
}

/**
 * What the composer appends to the graph while a screen is being authored:
 * the open card at one lane's tail, or — while a fork is being authored —
 * one extra band hanging off the fork step.
 *
 * The «+ Añadir pantalla» affordance is NOT here. It used to be a full
 * screen-sized ghost node, which cost every band ~530px of width and was the
 * loudest object on the canvas; it is now a constant-size chip drawn as chrome
 * after a lane's last screen, so the layout never reserves room for it.
 */
export interface TailSpec {
	/** Lane key → the box the open card fills at that lane's tail. */
	tail: ReadonlyMap<string, Box>;
	forkCard: {
		/** Flat index of the trunk step the new branch leaves from. */
		fork: number;
		width: number;
		height: number;
		/** The fork edge's label — the branch name as typed so far. */
		label: string;
	} | null;
}

/**
 * Derive nodes, edges and bands from the walk `layOut` produced.
 *
 * Synthetic keys are collision-proof by their FIRST segment: a real key is
 * `trunk:…` or `branch:…` (`laneKey`'s only outputs), a synthetic one is
 * `ghost:…` or `card:…` — so even a branch literally named "ghost" yields
 * `branch:ghost:…`, never `ghost:…`.
 */
export function graphOf(lanes: readonly Lane[], tails?: TailSpec): FlowGraph {
	const nodes: GraphNode[] = [];
	const edges: GraphEdge[] = [];
	const bands: GraphBand[] = [];
	const trunk = lanes.find((lane) => lane.kind === "trunk");

	for (const lane of lanes) {
		const key = lane.kind === "trunk" ? laneKey(null) : laneKey(lane.id);
		const nodeKeys: string[] = [];

		for (const [index, stepNode] of lane.nodes.entries()) {
			const { box, anchorY } = stepBoxOf(stepNode);
			nodes.push({ kind: "step", key: stepNode.key, node: stepNode, box, anchorY });
			nodeKeys.push(stepNode.key);
			const previous = lane.nodes[index - 1];
			if (previous) {
				edges.push({
					id: `${previous.key}→${stepNode.key}`,
					from: previous.key,
					to: stepNode.key,
					// The vía of the step this edge LEADS TO.
					label: stepNode.step.via ? `«${stepNode.step.via}»` : null,
					kind: "step",
				});
			}
		}

		let forkKey: string | null = null;
		let orphan = false;
		if (lane.kind === "branch") {
			const forkNode = lane.fork === null ? undefined : trunk?.nodes[lane.fork];
			const first = lane.nodes[0];
			if (forkNode && first) {
				forkKey = forkNode.key;
				edges.push({
					id: `${forkNode.key}→${first.key}`,
					from: forkNode.key,
					to: first.key,
					// The branch NAME only. The band's caption already reads
					// "desde el paso N · vía «…»" directly above this node, and
					// printing the vía twice within an inch of itself is noise.
					label: lane.label,
					kind: "fork",
				});
			} else {
				orphan = lane.fork === null;
			}
		}

		const tail = tails?.tail.get(key);
		const lastKey = nodeKeys[nodeKeys.length - 1];
		if (tail) {
			const tailKey = tailKeyOf(key);
			nodes.push({
				kind: "card",
				key: tailKey,
				laneKey: key,
				fork: false,
				box: tail,
				anchorY: tail.height / 2,
			});
			nodeKeys.push(tailKey);
			// A hand-edited empty lane can hold a card with nothing before it.
			if (lastKey) {
				edges.push({
					id: `${lastKey}→${tailKey}`,
					from: lastKey,
					to: tailKey,
					label: null,
					kind: "tail",
				});
			}
		}

		bands.push({
			laneKey: key,
			label:
				lane.kind === "trunk"
					? null
					: `${lane.label} · desde el paso ${lane.from + 1}` +
						(lane.nodes[0]?.step.via ? ` · vía «${lane.nodes[0].step.via}»` : "") +
						(lane.fork === null ? " — ese paso no está en el tronco" : ""),
			forkKey,
			orphan,
			nodeKeys,
		});
	}

	const forkCard = tails?.forkCard;
	if (forkCard) {
		// Trunk flat indices are trunk positions, so `find` by flat is exact.
		const forkNode = trunk?.nodes.find((node) => node.flat === forkCard.fork);
		const cardKey = forkCardKey(forkCard.fork);
		const box: Box = { width: forkCard.width, height: forkCard.height };
		nodes.push({
			kind: "card",
			key: cardKey,
			laneKey: FORK_CARD_BAND,
			fork: true,
			box,
			anchorY: box.height / 2,
		});
		if (forkNode) {
			edges.push({
				id: `${forkNode.key}→${cardKey}`,
				from: forkNode.key,
				to: cardKey,
				label: forkCard.label,
				kind: "fork",
			});
		}
		bands.push({
			laneKey: FORK_CARD_BAND,
			label: `${forkCard.label} · desde el paso ${forkCard.fork + 1}`,
			forkKey: forkNode?.key ?? null,
			// Same rule a branch gets: a fork nobody can resolve is attached to
			// nothing, and must not seat itself beside the trunk.
			orphan: forkNode === undefined,
			nodeKeys: [cardKey],
		});
	}

	return { nodes, edges, bands };
}

/** Where a band ended up: the row it joined and the box it fills. */
export interface BandPlacement {
	laneKey: string;
	/** What the section above this band reads. */
	label: string | null;
	row: number;
	/** The box the band's screens occupy. */
	x: number;
	y: number;
	width: number;
	height: number;
	/**
	 * The box the band DRAWS as — its screens plus the room its label and its
	 * padding need. One owner: the bbox below counts exactly this, so a change
	 * to either pad cannot leave the fit clipping a section it forgot about.
	 */
	section: Box & { x: number; y: number };
}

/**
 * Deterministic row packing.
 *
 * Bands used to stack one per row, which made the graph tall and narrow — the
 * height axis bound the fit on every real flow, so «Ajustar» showed a shape
 * nobody could read. A band now joins the LAST row when it may, and opens a
 * new one when it may not. It may not when either holds:
 *
 * 1. that row already holds the band this one forks from — a branch level with
 *    the very step it leaves reads as the trunk carrying on; or
 * 2. this band is an orphan, attached to nothing, so it may sit beside nothing.
 *
 * Only the LAST row is ever joined. An earlier row's `y` is fixed the moment
 * the row below it exists, but its HEIGHT still grows as bands join it — join
 * an earlier row with a taller screen and its band would grow down through the
 * rows already placed beneath. Packing rightward without bound is the cost;
 * the fit's other axis pays it.
 *
 * Placement follows the lanes' own order, so the result is stable — the same
 * flow lays out the same way every time, which a test asserts by laying it out
 * twice. Siblings share a row (Tier 1 beside Tier 2, both under the trunk),
 * and a fork edge that must travel past a sibling goes through the row gutter
 * rather than over it — see `projectEdges`.
 */
export function layoutGraph(graph: FlowGraph): {
	positions: ReadonlyMap<string, { x: number; y: number }>;
	bands: BandPlacement[];
	bbox: { minX: number; minY: number; maxX: number; maxY: number };
} {
	const byKey = new Map(graph.nodes.map((node) => [node.key, node]));
	const positions = new Map<string, { x: number; y: number }>();
	// The label an in-band edge carries INTO each node, so the gap before that
	// node can hold it.
	const labelInto = new Map<string, string | null>();
	for (const edge of graph.edges) {
		if (edge.kind === "step" || edge.kind === "fork") labelInto.set(edge.to, edge.label);
	}

	/** The width a band needs, laid out left to right from its own origin. */
	const spanOf = (band: GraphBand): { width: number; height: number } => {
		let width = 0;
		let height = 0;
		for (const [position, key] of band.nodeKeys.entries()) {
			const node = byKey.get(key);
			if (!node) continue;
			width += node.box.width;
			height = Math.max(height, node.box.height);
			const nextKey = band.nodeKeys[position + 1];
			if (nextKey) width += labelGap(labelInto.get(nextKey) ?? null);
		}
		return { width, height };
	};

	/** Which lane holds a given node key — how rule 1 finds the fork's band. */
	const laneOfNode = new Map<string, string>();
	for (const band of graph.bands) {
		for (const key of band.nodeKeys) laneOfNode.set(key, band.laneKey);
	}

	interface Row {
		y: number;
		/** Right edge of everything placed on this row so far. */
		right: number;
		height: number;
		lanes: Set<string>;
	}
	const rows: Row[] = [];
	const rowOfLane = new Map<string, number>();
	const placements: BandPlacement[] = [];
	let floor = 0;

	for (const band of graph.bands) {
		const span = spanOf(band);
		// Never left of the fork column: a branch must read as leaving its step.
		let minX = 0;
		let forkLane: string | null = null;
		let forkRow = 0;
		if (band.forkKey) {
			const fork = positions.get(band.forkKey);
			const forkNode = byKey.get(band.forkKey);
			const first = band.nodeKeys[0];
			if (fork && forkNode) {
				minX =
					fork.x + forkNode.box.width + labelGap(first ? (labelInto.get(first) ?? null) : null);
			}
			forkLane = laneOfNode.get(band.forkKey) ?? null;
			forkRow = (forkLane !== null ? rowOfLane.get(forkLane) : undefined) ?? 0;
		}

		// An orphan is attached to nothing, so it may sit beside nothing:
		// seated after the trunk it would read as continuing a journey it is
		// explicitly not part of.
		const last = rows[rows.length - 1];
		const allowed =
			last !== undefined &&
			// Rule 1: never beside the band this one forks from.
			!(forkLane !== null && last.lanes.has(forkLane)) &&
			// Rule 2: an orphan is attached to nothing, so it sits beside nothing.
			!band.orphan &&
			// And never above the fork: an edge travelling upward reads as
			// going back in the journey.
			rows.length - 1 >= forkRow;

		// Rule 3, when the first three allow it: take whichever of joining and
		// wrapping leaves the whole graph nearer `TARGET_ASPECT`. Greedy and
		// one band deep, which is enough — the choice is only ever "beside" or
		// "under", and both outcomes are fully known here.
		let joinable = allowed;
		if (allowed && last) {
			const widest = rows.reduce((most, row) => Math.max(most, row.right), 0);
			const joinedWidth = Math.max(widest, Math.max(minX, last.right + NODE_GAP_X) + span.width);
			const joinedHeight = Math.max(floor, last.y + Math.max(last.height, span.height));
			const wrappedWidth = Math.max(widest, minX + span.width);
			const wrappedHeight = floor + NODE_GAP_Y + span.height;
			const off = (width: number, height: number) =>
				Math.abs(width / Math.max(1, height) - TARGET_ASPECT);
			joinable = off(joinedWidth, joinedHeight) <= off(wrappedWidth, wrappedHeight);
		}
		const target: Row =
			joinable && last
				? last
				: { y: rows.length === 0 ? 0 : floor + NODE_GAP_Y, right: 0, height: 0, lanes: new Set() };
		if (target !== last) rows.push(target);
		const index = rows.length - 1;
		const x = target.lanes.size === 0 ? minX : Math.max(minX, target.right + NODE_GAP_X);

		let cursor = x;
		for (const [position, key] of band.nodeKeys.entries()) {
			const node = byKey.get(key);
			if (!node) continue;
			positions.set(key, { x: cursor, y: target.y });
			const nextKey = band.nodeKeys[position + 1];
			cursor += node.box.width + (nextKey ? labelGap(labelInto.get(nextKey) ?? null) : 0);
		}
		target.right = Math.max(target.right, x + span.width);
		target.height = Math.max(target.height, span.height);
		target.lanes.add(band.laneKey);
		rowOfLane.set(band.laneKey, index);
		floor = Math.max(floor, target.y + target.height);
		placements.push({
			laneKey: band.laneKey,
			label: band.label,
			row: index,
			x,
			y: target.y,
			width: span.width,
			height: span.height,
			section: {
				x: x - SECTION_PAD,
				y: target.y - SECTION_LIFT,
				width: span.width + SECTION_PAD * 2,
				height: span.height + SECTION_LIFT + SECTION_PAD,
			},
		});
	}

	if (positions.size === 0) {
		return { positions, bands: placements, bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
	}
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const node of graph.nodes) {
		const at = positions.get(node.key);
		if (!at) continue;
		minX = Math.min(minX, at.x);
		minY = Math.min(minY, at.y);
		maxX = Math.max(maxX, at.x + node.box.width);
		maxY = Math.max(maxY, at.y + node.box.height);
	}
	// The bbox is the union of the SECTIONS, not of the screens: the label
	// lifted above the top row is the one thing readable when zoomed out, and
	// a fit that clipped it would defeat the whole point of drawing it.
	for (const band of placements) {
		minX = Math.min(minX, band.section.x);
		minY = Math.min(minY, band.section.y);
		maxX = Math.max(maxX, band.section.x + band.section.width);
		maxY = Math.max(maxY, band.section.y + band.section.height);
	}
	return { positions, bands: placements, bbox: { minX, minY, maxX, maxY } };
}

/** An edge as the canvas wants it: world-space anchor points plus the label. */
export interface ProjectedEdge {
	id: string;
	from: { x: number; y: number };
	to: { x: number; y: number };
	label: string | null;
	variant: "solid" | "dashed";
	/** Extra points the path must pass through, in order — a routed fork. */
	waypoints?: Array<{ x: number; y: number }>;
}

/**
 * The gutter y an edge travels along when it has to pass a band: the middle
 * of the empty strip between the source's row and the target's.
 */
export function gutterBetween(sourceBottom: number, targetTop: number): number {
	return sourceBottom + (targetTop - sourceBottom) / 2;
}

/** Right-center of the source screen → left-center of the target screen. */
export function projectEdges(
	graph: FlowGraph,
	positions: ReadonlyMap<string, { x: number; y: number }>,
): ProjectedEdge[] {
	const byKey = new Map(graph.nodes.map((node) => [node.key, node]));
	const projected: ProjectedEdge[] = [];
	for (const edge of graph.edges) {
		const from = positions.get(edge.from);
		const fromNode = byKey.get(edge.from);
		const to = positions.get(edge.to);
		const toNode = byKey.get(edge.to);
		if (!from || !fromNode || !to || !toNode) continue;
		const start = { x: from.x + fromNode.box.width, y: from.y + fromNode.anchorY };
		const end = { x: to.x, y: to.y + toNode.anchorY };
		// A fork that drops to a lower row and reaches well past the source is
		// travelling across somebody else's band. It goes through the gutter —
		// down out of the source, along the empty strip, then up into the
		// target — instead of straight over their screens.
		const drops = to.y > from.y + fromNode.box.height;
		const routed = drops && end.x > start.x + NODE_GAP_X;
		projected.push({
			id: edge.id,
			label: edge.label,
			variant: edge.kind === "tail" ? "dashed" : "solid",
			from: start,
			to: end,
			...(routed
				? {
						waypoints: [
							{
								x: start.x + NODE_GAP_X / 2,
								y: gutterBetween(from.y + fromNode.box.height, to.y),
							},
							{
								x: end.x - NODE_GAP_X / 2,
								y: gutterBetween(from.y + fromNode.box.height, to.y),
							},
						],
					}
				: {}),
		});
	}
	return projected;
}
