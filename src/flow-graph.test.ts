import { describe, expect, it } from "vitest";
import {
	cardBoxOf,
	forkCardKey,
	FORK_CARD_BAND,
	graphOf,
	labelGap,
	layoutGraph,
	NODE_GAP_X,
	NODE_GAP_Y,
	projectEdges,
	SECTION_LIFT,
	SECTION_PAD,
	tailKeyOf,
	type TailSpec,
} from "./flow-graph";
import { layOut } from "./flow-layout";
import type { Flow, FlowStep, Viewport } from "./manifest.types";
import { FRAME_CHROME } from "./screen-frame";

const movil: Viewport = { id: "movil", label: "Móvil", width: 390, height: 844, note: null };
const escritorio: Viewport = {
	id: "escritorio",
	label: "Escritorio",
	width: 1440,
	height: 900,
	note: null,
};
const viewportOf = (id: string) => (id === "escritorio" ? escritorio : movil);

function step(route: string, extra: Partial<FlowStep> = {}): FlowStep {
	return {
		label: route,
		route,
		via: null,
		viewport: "movil",
		note: null,
		notice: null,
		spec: null,
		exists: true,
		...extra,
	};
}

function flow(steps: FlowStep[], branches: Flow["branches"] = []): Flow {
	return { id: "login", title: "Login", description: null, origin: "config", steps, branches };
}

const login = flow(
	[step("/"), step("/registro", { via: "Empezar" })],
	[
		{ id: "tier-1", label: "Tier 1", from: 1, steps: [step("/panel", { via: "Continuar" })] },
		{
			id: "tier-2",
			label: "Tier 2",
			from: 1,
			steps: [step("/panel/pro", { viewport: "escritorio" }), step("/facturas")],
		},
	],
);

// A box is exactly the screen plus the shell's padding — names and chips are
// constant-size chrome drawn outside it.
const MOVIL_W = 390 + FRAME_CHROME;
const MOVIL_H = 844 + FRAME_CHROME;
/** The trunk's one labelled gap: `/` → `/registro` vía «Empezar». */
const EMPEZAR_GAP = labelGap("«Empezar»");
/** Where the trunk's second step, and therefore every fork, starts. */
const FORK_X = MOVIL_W + EMPEZAR_GAP;
/** Where a branch of the trunk's step 2 begins. */
const BRANCH_X = FORK_X + MOVIL_W + labelGap("Tier 1");

function laidOut(target: Flow, tails?: TailSpec) {
	const graph = graphOf(layOut(target, viewportOf).lanes, tails);
	return { graph, ...layoutGraph(graph) };
}

describe("graphOf", () => {
	it("derives step edges labelled by the vía of the step they lead to", () => {
		const { graph } = laidOut(login);
		const trunkEdge = graph.edges.find((edge) => edge.kind === "step");
		expect(trunkEdge?.from).toBe("trunk:0:/");
		expect(trunkEdge?.to).toBe("trunk:1:/registro");
		expect(trunkEdge?.label).toBe("«Empezar»");
	});

	it("fans two branches from one fork node, labels carrying the branch name", () => {
		const { graph } = laidOut(login);
		const forks = graph.edges.filter((edge) => edge.kind === "fork");
		expect(forks.map((edge) => edge.from)).toEqual(["trunk:1:/registro", "trunk:1:/registro"]);
		// The branch NAME only — the band caption carries "desde el paso N ·
		// vía «…»" right above the same node.
		expect(forks[0]?.label).toBe("Tier 1");
		expect(forks[1]?.label).toBe("Tier 2");
	});

	it("keeps an orphan branch as a band with no edge, and says so", () => {
		const orphan = flow([step("/")], [{ id: "x", label: "X", from: 4, steps: [step("/y")] }]);
		const { graph, positions } = laidOut(orphan);
		expect(graph.edges.filter((edge) => edge.kind === "fork")).toHaveLength(0);
		const band = graph.bands[1];
		expect(band?.orphan).toBe(true);
		// Its own row at the left margin: an orphan seated after the trunk
		// would read as continuing the journey it is not part of.
		expect(positions.get("branch:x:0:/y")).toEqual({ x: 0, y: MOVIL_H + NODE_GAP_Y });
	});

	it("synthetic keys can never collide with ledger keys", () => {
		// Even a branch literally named "ghost" keys as `branch:ghost:…`.
		const tricky = flow(
			[step("/")],
			[{ id: "ghost", label: "Ghost", from: 0, steps: [step("/g")] }],
		);
		const tails: TailSpec = {
			tail: new Map([
				["trunk", cardBoxOf(movil)],
				["branch:ghost", cardBoxOf(movil)],
			]),
			forkCard: null,
		};
		const { graph } = laidOut(tricky, tails);
		const keys = graph.nodes.map((node) => node.key);
		expect(new Set(keys).size).toBe(keys.length);
		expect(keys).toContain("branch:ghost:0:/g");
		expect(keys).toContain("card:branch:ghost");
		for (const node of graph.nodes) {
			if (node.kind === "step") expect(node.key.startsWith("card:")).toBe(false);
		}
	});
});

describe("layoutGraph", () => {
	it("lines a trunk up on one baseline with the gap between boxes", () => {
		const { positions } = laidOut(login);
		expect(positions.get("trunk:0:/")).toEqual({ x: 0, y: 0 });
		expect(positions.get("trunk:1:/registro")).toEqual({ x: FORK_X, y: 0 });
	});

	it("packs siblings onto one row instead of stacking them", () => {
		// The whole point of packing: two branches of the same fork used to
		// cost two rows of screen height, and the height axis is what binds
		// the fit on every real flow.
		const { positions, bands } = laidOut(login);
		const tier1 = positions.get("branch:tier-1:0:/panel");
		const tier2 = positions.get("branch:tier-2:0:/panel/pro");
		expect(tier1?.y).toBe(MOVIL_H + NODE_GAP_Y);
		expect(tier2?.y).toBe(tier1?.y);
		expect(bands.map((band) => band.row)).toEqual([0, 1, 1]);
		// Tier 1 starts at its fork column; Tier 2 follows it along the row.
		expect(tier1?.x).toBe(BRANCH_X);
		expect(tier2?.x).toBe(BRANCH_X + MOVIL_W + NODE_GAP_X);
	});

	it("never seats a branch beside the band it forks from", () => {
		// A branch level with the very step it leaves reads as the trunk
		// carrying on, so rule 1 forbids it even when there is room.
		const { bands } = laidOut(login);
		const trunkRow = bands.find((band) => band.laneKey === "trunk")?.row;
		for (const band of bands.filter((candidate) => candidate.laneKey !== "trunk")) {
			expect(band.row).not.toBe(trunkRow);
		}
	});

	it("packs every sibling of one fork onto the same free row", () => {
		const deep = flow(
			[step("/"), step("/registro", { via: "Empezar" })],
			[
				{ id: "tier-1", label: "Tier 1", from: 1, steps: [step("/panel", { via: "Continuar" })] },
				{ id: "tier-2", label: "Tier 2", from: 1, steps: [step("/panel/pro")] },
				{ id: "tier-3", label: "Tier 3", from: 1, steps: [step("/facturas")] },
			],
		);
		const { bands } = laidOut(deep);
		// All three fork from the trunk, so none may share the trunk's row;
		// they pack onto the first row that is free of it.
		expect(bands.map((band) => band.row)).toEqual([0, 1, 1, 1]);
	});

	it("wraps a band under the row rather than let the graph run away sideways", () => {
		const { graph, positions } = laidOut(login, {
			tail: new Map(),
			forkCard: { fork: 1, width: 390, height: 844, label: "nueva rama" },
		});
		// Row 1 already holds both branches and ends past 3700; putting the
		// fork card beside them would take the graph to 4269 × 1912 (2.2:1),
		// where underneath leaves 3715 × 2900 (1.3:1) — nearer the shape a
		// canvas panel actually has.
		const tier2 = positions.get("branch:tier-2:0:/panel/pro");
		const card = positions.get("card:fork:1");
		expect(card?.y).toBeGreaterThan(tier2?.y ?? 0);
		expect(graph.bands.at(-1)?.laneKey).toBe(FORK_CARD_BAND);
		// And it still hangs off its fork column, not the left margin.
		expect(card?.x).toBe(FORK_X + MOVIL_W + labelGap("nueva rama"));
	});

	it("still packs siblings side by side when that is the better shape", () => {
		// The guard must not become "always wrap": two móvil branches beside
		// each other give 2665 × 1856 (1.4:1), stacked they give 1557 × 2844
		// (0.5:1). Beside wins, and the earlier packing test proves it holds.
		const { bands } = laidOut(login);
		expect(bands.filter((band) => band.row === 1)).toHaveLength(2);
	});

	it("the open card is a node, an edge and part of the bbox", () => {
		const tails: TailSpec = {
			tail: new Map([["trunk", cardBoxOf(movil)]]),
			forkCard: null,
		};
		const { graph, positions, bbox } = laidOut(flow([step("/")]), tails);
		const card = positions.get("card:trunk");
		expect(card).toEqual({ x: MOVIL_W + NODE_GAP_X, y: 0 });
		expect(graph.edges.find((edge) => edge.kind === "tail")?.to).toBe("card:trunk");
		// The bbox is the union of the SECTIONS, not of the screens: the fit
		// must not clip the label that is readable when everything else is not.
		expect(bbox.maxX).toBe(MOVIL_W + NODE_GAP_X + MOVIL_W + SECTION_PAD);
		expect(bbox.minX).toBe(-SECTION_PAD);
		expect(bbox.minY).toBe(-SECTION_LIFT);
	});

	it("lays out the same input the same twice", () => {
		const first = laidOut(login);
		const second = laidOut(login);
		expect([...first.positions.entries()]).toEqual([...second.positions.entries()]);
		expect(first.bbox).toEqual(second.bbox);
	});
});

describe("projectEdges", () => {
	it("anchors right-center of the source screen to left-center of the target", () => {
		const { graph, positions } = laidOut(login);
		const projected = projectEdges(graph, positions);
		const trunkEdge = projected.find((edge) => edge.id === "trunk:0:/→trunk:1:/registro");
		const anchorY = MOVIL_H / 2;
		expect(trunkEdge?.from).toEqual({ x: MOVIL_W, y: anchorY });
		expect(trunkEdge?.to).toEqual({ x: FORK_X, y: anchorY });
		expect(trunkEdge?.variant).toBe("solid");
	});
});

describe("routed fork edges", () => {
	it("sends an edge that must pass a band through the gutter, not over it", () => {
		// Tier 2 sits to the right of Tier 1 on the same row, so a straight
		// chord from the fork would cross Tier 1's screen.
		const { graph, positions } = laidOut(login);
		const projected = projectEdges(graph, positions);
		const toTier2 = projected.find(
			(edge) => edge.to.x === positions.get("branch:tier-2:0:/panel/pro")?.x,
		);
		expect(toTier2?.waypoints).toHaveLength(2);
		const gutter = MOVIL_H + NODE_GAP_Y / 2;
		expect(toTier2?.waypoints?.map((point) => point.y)).toEqual([gutter, gutter]);
		// It leaves the source and arrives at the target, travelling between.
		expect(toTier2?.waypoints?.[0]?.x).toBeLessThan(toTier2?.waypoints?.[1]?.x ?? 0);
	});

	it("leaves a short hop alone", () => {
		// Tier 1 hangs directly under its fork column: nothing to route around.
		const { graph, positions } = laidOut(login);
		const projected = projectEdges(graph, positions);
		const toTier1 = projected.find(
			(edge) => edge.to.x === positions.get("branch:tier-1:0:/panel")?.x,
		);
		expect(toTier1?.waypoints).toBeUndefined();
	});

	it("keeps a same-row step edge straight", () => {
		const { graph, positions } = laidOut(login);
		const projected = projectEdges(graph, positions);
		const trunkEdge = projected.find((edge) => edge.id === "trunk:0:/→trunk:1:/registro");
		expect(trunkEdge?.waypoints).toBeUndefined();
	});
});

describe("labelGap", () => {
	it("keeps the plain gap for an unlabelled edge", () => {
		expect(labelGap(null)).toBe(NODE_GAP_X);
		expect(labelGap("«Ir»")).toBe(NODE_GAP_X);
	});

	it("widens the gap so a long vía cannot paint under the screens beside it", () => {
		// The label is centred in the gap between two OPAQUE screens; a fixed
		// gap buried «Continuar con Google» under both.
		const label = "«Continuar con Google»";
		expect(labelGap(label)).toBeGreaterThan(NODE_GAP_X);
		const wide = flow([step("/"), step("/g", { via: "Continuar con Google" })]);
		const { positions } = laidOut(wide);
		const second = positions.get("trunk:1:/g");
		expect(second?.x).toBe(MOVIL_W + labelGap(label));
	});
});

describe("shared keys and boxes", () => {
	it("mints the keys the board looks positions up by", () => {
		expect(tailKeyOf("trunk")).toBe("card:trunk");
		expect(tailKeyOf("branch:tier-1")).toBe("card:branch:tier-1");
		expect(forkCardKey(2)).toBe("card:fork:2");
	});

	it("sizes a box as the screen plus the shell's padding, and nothing else", () => {
		// Names and chips are constant-size chrome drawn outside the box now,
		// so the layout stops reserving world room for text it never draws.
		expect(cardBoxOf(movil)).toEqual({ width: 390 + FRAME_CHROME, height: 844 + FRAME_CHROME });
	});

	it("an empty lane can still hold the card, with no edge to draw it from", () => {
		// Only reachable by hand-editing the config — but a lane with no way
		// to add its first screen reads as read-only rather than broken.
		const empty = flow([]);
		const tails: TailSpec = { tail: new Map([["trunk", cardBoxOf(movil)]]), forkCard: null };
		const { graph, positions } = laidOut(empty, tails);
		expect(positions.get("card:trunk")).toEqual({ x: 0, y: 0 });
		expect(graph.edges).toHaveLength(0);
	});
});

describe("sections", () => {
	it("gives every band a drawn box that holds its screens and its label", () => {
		const { bands, positions } = laidOut(login);
		for (const band of bands) {
			expect(band.section.x).toBe(band.x - SECTION_PAD);
			expect(band.section.y).toBe(band.y - SECTION_LIFT);
			expect(band.section.width).toBeGreaterThanOrEqual(band.width);
			expect(band.section.height).toBeGreaterThanOrEqual(band.height);
		}
		// And a band's section really does contain the nodes it placed.
		const trunk = bands.find((band) => band.laneKey === "trunk");
		const last = positions.get("trunk:1:/registro");
		expect(trunk && last && last.x + MOVIL_W).toBeLessThanOrEqual(
			(trunk?.section.x ?? 0) + (trunk?.section.width ?? 0),
		);
	});
});
