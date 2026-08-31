import { describe, expect, it } from "vitest";
import { forkPrefix, laneKey, layOut, rowExtents, type Lane } from "./flow-layout";
import type { Flow, FlowStep, Viewport } from "./manifest.types";
import { FRAME_CHROME, STEP_GUTTER } from "./screen-frame";

const movil: Viewport = { id: "movil", label: "Móvil", width: 390, height: 844, note: null };
const escritorio: Viewport = {
	id: "escritorio",
	label: "Escritorio",
	width: 1440,
	height: 900,
	note: null,
};
const viewportOf = (id: string) => (id === "escritorio" ? escritorio : movil);

function step(route: string, viewport = "movil", exists = true): FlowStep {
	return { label: route, route, via: null, viewport, note: null, spec: null, exists };
}

function flow(steps: FlowStep[], branches: Flow["branches"] = []): Flow {
	return { id: "login", title: "Login", description: null, origin: "config", steps, branches };
}

function branch(lane: Lane | undefined): Extract<Lane, { kind: "branch" }> {
	if (lane?.kind !== "branch") throw new Error("expected a branch lane");
	return lane;
}

// The example's flow: a two-step trunk, tier 1 forks to one built page and
// tier 2 to two unbuilt ones, one of them a desktop screen.
const login = flow(
	[step("/"), step("/registro")],
	[
		{ id: "tier-1", label: "Tier 1", from: 1, steps: [step("/panel")] },
		{
			id: "tier-2",
			label: "Tier 2",
			from: 1,
			steps: [step("/panel/pro", "escritorio", false), step("/facturas", "movil", false)],
		},
	],
);

describe("layOut", () => {
	it("walks the trunk first, then each branch in declared order", () => {
		const { lanes, nodes } = layOut(login, viewportOf);
		expect(nodes.map((node) => node.step.route)).toEqual([
			"/",
			"/registro",
			"/panel",
			"/panel/pro",
			"/facturas",
		]);
		// `flat` IS the walk position: every piece of sweep state indexes by it.
		expect(nodes.map((node) => node.flat)).toEqual([0, 1, 2, 3, 4]);
		expect(lanes.map((lane) => lane.kind)).toEqual(["trunk", "branch", "branch"]);
		expect(lanes.flatMap((lane) => lane.nodes.map((node) => node.flat))).toEqual([0, 1, 2, 3, 4]);
	});

	it("numbers a branch from the fork step the way the brief does", () => {
		// `tickets.rs` writes `fork + 2 + index` into the ticket. The board must
		// print the same numbers, or the ticket and the screen disagree on
		// which step is "3" — and nothing but this test keeps them agreeing.
		const { lanes } = layOut(login, viewportOf);
		expect(lanes[0]?.nodes.map((node) => node.number)).toEqual([1, 2]);
		expect(branch(lanes[1]).nodes.map((node) => node.number)).toEqual([3]);
		expect(branch(lanes[2]).nodes.map((node) => node.number)).toEqual([3, 4]);
		expect(branch(lanes[2]).fork).toBe(1);
	});

	it("a branch whose fork is not in the trunk keeps its claim and loses its offset", () => {
		const orphan = flow([step("/")], [{ id: "x", label: "X", from: 4, steps: [step("/y")] }]);
		const { lanes } = layOut(orphan, viewportOf);
		const lane = branch(lanes[1]);
		expect(lane.from).toBe(4);
		expect(lane.fork).toBeNull();
		expect(lane.nodes.map((node) => node.number)).toEqual([6]);
		expect(forkPrefix(lanes, lane.fork)).toEqual([]);
	});

	it("honours each step's own viewport", () => {
		const { nodes } = layOut(login, viewportOf);
		expect(nodes.map((node) => node.viewport.width)).toEqual([390, 390, 390, 1440, 390]);
	});

	it("keys every node by lane, position and route — the frames ledger's key", () => {
		const { nodes, lanes } = layOut(login, viewportOf);
		expect(nodes.map((node) => node.key)).toEqual([
			"trunk:0:/",
			"trunk:1:/registro",
			"branch:tier-1:0:/panel",
			"branch:tier-2:0:/panel/pro",
			"branch:tier-2:1:/facturas",
		]);
		// The wire addresses a branch by position; the key by id.
		expect(branch(lanes[1]).index).toBe(0);
		expect(branch(lanes[2]).index).toBe(1);
		expect(laneKey(null)).toBe("trunk");
		expect(laneKey("tier-2")).toBe("branch:tier-2");
	});
});

describe("rowExtents", () => {
	it("a branch row counts the trunk columns it starts after", () => {
		const { lanes } = layOut(login, viewportOf);
		expect(forkPrefix(lanes, 1)).toEqual([390, 390]);
		const [trunk, tier1, tier2] = rowExtents(lanes);
		expect(trunk).toEqual({ natural: 780, gutters: 2 * FRAME_CHROME + STEP_GUTTER });
		expect(tier1).toEqual({ natural: 1170, gutters: 3 * FRAME_CHROME + 2 * STEP_GUTTER });
		expect(tier2).toEqual({
			natural: 780 + 1440 + 390,
			gutters: 4 * FRAME_CHROME + 3 * STEP_GUTTER,
		});
	});

	it("counts the composer's tails: a ghost column per row and the fork row", () => {
		// `fit` must know about the ghost and the card, or opening one puts a
		// scrollbar on a board whose promise is that it fits.
		const { lanes } = layOut(login, viewportOf);
		const rows = rowExtents(lanes, {
			tail: new Map([
				[laneKey(null), 390],
				[laneKey("tier-1"), 390],
			]),
			forkRow: { fork: 1, width: 390 },
		});
		expect(rows).toHaveLength(4);
		expect(rows[0]).toEqual({ natural: 1170, gutters: 3 * FRAME_CHROME + 2 * STEP_GUTTER });
		expect(rows[1]).toEqual({ natural: 1560, gutters: 4 * FRAME_CHROME + 3 * STEP_GUTTER });
		// tier-2 asked for no tail and is unchanged.
		expect(rows[2]).toEqual({
			natural: 780 + 1440 + 390,
			gutters: 4 * FRAME_CHROME + 3 * STEP_GUTTER,
		});
		// The authored branch row: the trunk prefix through the fork, then the card.
		expect(rows[3]).toEqual({ natural: 1170, gutters: 3 * FRAME_CHROME + 2 * STEP_GUTTER });
	});
});
