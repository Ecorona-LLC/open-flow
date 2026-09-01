import type { Flow, FlowStep, Viewport } from "./manifest.types";

/**
 * The Flujos storyboard's geometry, as data: which screens there are, in
 * which rows, and what each row asks of the container.
 *
 * Pure on purpose. The number a person reads on a branch step is also written
 * by the brief `workbench flow new` produces (`tickets.rs`), and nothing but a
 * test keeps the two agreeing — so the walk lives where a test can call it
 * with a manifest literal, not inside the component that draws it.
 */

/**
 * One screen of the storyboard, in the flat order the sweep walks: the trunk
 * first, then each branch in declared order. Per-step state — the frames
 * ledger, the active frame — is keyed by `key`, so a screen added or removed
 * elsewhere on the board disturbs no other entry; `flat` remains the walk
 * order, and the one-capture-in-flight rule never sees a tree.
 */
export interface StepNode {
	/** `lane:position:route` — stable across edits elsewhere on the board. */
	key: string;
	flat: number;
	/** The number a person reads: trunk steps count from 1, a branch's from
	 *  the fork step + 1, matching the brief `flow new` writes. */
	number: number;
	step: FlowStep;
	viewport: Viewport;
}

/** The row half of a `StepNode.key`: the trunk, or a branch by id. */
export function laneKey(branchId: string | null): string {
	return branchId === null ? "trunk" : `branch:${branchId}`;
}

/** A row of the storyboard: the trunk, or a branch continuing from one of its steps. */
export type Lane =
	| { kind: "trunk"; nodes: StepNode[] }
	| {
			kind: "branch";
			id: string;
			/** Position in `flow.branches` — how the wire addresses this lane. */
			index: number;
			label: string;
			/** Zero-based trunk step the branch continues from, as the manifest says. */
			from: number;
			/**
			 * Flat index of that trunk step — or null when `from` points past the
			 * trunk. The manifest contract forbids that (the scanner drops and
			 * announces such a branch), but a hand-edited file can still do it,
			 * and the row is then drawn at the left edge and SAYS so, rather than
			 * passing as a second trunk.
			 */
			fork: number | null;
			nodes: StepNode[];
	  };

/** The trunk and each branch as rows of nodes, plus the flat walk order. */
export function layOut(
	flow: Flow,
	viewportOf: (id: string) => Viewport,
): { lanes: Lane[]; nodes: StepNode[] } {
	const nodes: StepNode[] = [];
	const place = (steps: FlowStep[], first: number, lane: string): StepNode[] =>
		steps.map((step, index) => ({
			key: `${lane}:${index}:${step.route}`,
			flat: nodes.length + index,
			number: first + index,
			step,
			viewport: viewportOf(step.viewport),
		}));

	const trunk = place(flow.steps, 1, laneKey(null));
	nodes.push(...trunk);
	const lanes: Lane[] = [{ kind: "trunk", nodes: trunk }];
	for (const [index, branch] of flow.branches.entries()) {
		// Continues the trunk's numbering from the fork step (`from + 1`), so
		// the first branch step is `from + 2` — the brief's rule, verbatim.
		const branchNodes = place(branch.steps, branch.from + 2, laneKey(branch.id));
		nodes.push(...branchNodes);
		lanes.push({
			kind: "branch",
			id: branch.id,
			index,
			label: branch.label,
			from: branch.from,
			fork: trunk[branch.from]?.flat ?? null,
			nodes: branchNodes,
		});
	}
	return { lanes, nodes };
}

/**
 * Where a screen sits in the journey: its row, and its position in that row.
 *
 * Two callers were writing this loop — the panel's gesture handlers and the
 * board's right-click menu — which is two chances for "the last screen of a
 * row" to mean two things. The board's `situationOf` still derives `isLast`
 * inline because it already holds the lane and has nothing to scan for.
 */
export function locateNode(lanes: readonly Lane[], key: string) {
	for (const lane of lanes) {
		const position = lane.nodes.findIndex((node) => node.key === key);
		if (position === -1) continue;
		return { lane, position, isLast: position === lane.nodes.length - 1 };
	}
	return null;
}
