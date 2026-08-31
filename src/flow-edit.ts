import type { Flow, FlowStep } from "./manifest.types";
import type { FlowBody, FlowStepInput } from "./pin";

/**
 * Edits to a journey, expressed as the whole body `workbench flow set` reads.
 *
 * The board never patches: every gesture — a screen after «Iniciar sesión», a
 * fork, a removed tail — rebuilds the full body from the manifest's flow and
 * sends it through the engine, so the config entry a gesture writes and one
 * the terminal writes cannot drift. The corollary is documented honesty:
 * `bodyOf` re-sends what the manifest SHOWS, so anything the scan already
 * dropped and announced (an orphan branch, steps over the cap) is cleaned up
 * by the first edit — the storyboard edits what it can see.
 *
 * A chosen cost of the same corollary: the manifest cannot tell an authored
 * value from a derived one, so a step's `label_for`-derived label is re-sent
 * as if authored and lands in the config on the first edit. The one derived
 * value with ongoing behavioural drift — the default viewport — is elided
 * instead (`bodyOf` takes the default and omits matches), so a step that
 * never pinned a viewport keeps following the config's default.
 */

/** The row a gesture addresses: the trunk, or a branch by its position. */
export type LaneRef = { kind: "trunk" } | { kind: "branch"; index: number; id: string };

/**
 * Where a new screen lands. For a fork, `lane` is the trunk and `after` the
 * step the new branch leaves from; otherwise the card follows `after` in its
 * own lane (always the last step — mid-row inserts would re-key every column
 * to the right and re-sweep it).
 */
export interface ComposerTarget {
	lane: LaneRef;
	/** Position within the lane of the step the new screen follows. */
	after: number;
	/** That step's route when the card opened. Revalidated at submit: a
	 *  rescan can reshape the journey under an open card, and a stale index
	 *  would append to the wrong screen without a word. */
	anchorRoute: string;
	fork: boolean;
	/** That step's flat index on the board: viewport to inherit, offset to draw. */
	flat: number;
}

const or = (value: string | null): string => value ?? "";

function stepBody(step: FlowStep, defaultViewport: string): FlowStepInput {
	return {
		route: step.route,
		label: step.label,
		via: or(step.via),
		// The manifest always resolves a viewport; echoing the default back
		// would pin every touched step to today's default forever.
		viewport: step.viewport === defaultViewport ? "" : step.viewport,
		note: or(step.note),
		spec: or(step.spec),
	};
}

/** The manifest's flow as the wire wants it: branch `from` becomes the trunk
 *  ROUTE (the manifest's is an index), ids are echoed, nulls become "". */
export function bodyOf(flow: Flow, defaultViewport = ""): FlowBody {
	const step = (entry: FlowStep) => stepBody(entry, defaultViewport);
	return {
		title: flow.title,
		description: or(flow.description),
		intent: "",
		acceptance: "",
		steps: flow.steps.map(step),
		branches: flow.branches.map((branch) => ({
			id: branch.id,
			label: branch.label,
			from: flow.steps[branch.from]?.route ?? "",
			steps: branch.steps.map(step),
		})),
	};
}

export function appendStep(body: FlowBody, lane: LaneRef, step: FlowStepInput): FlowBody {
	if (lane.kind === "trunk") return { ...body, steps: [...body.steps, step] };
	return {
		...body,
		branches: body.branches.map((branch, index) =>
			index === lane.index ? { ...branch, steps: [...branch.steps, step] } : branch,
		),
	};
}

export function forkFrom(
	body: FlowBody,
	fromRoute: string,
	branchLabel: string,
	step: FlowStepInput,
): FlowBody {
	return {
		...body,
		branches: [...body.branches, { label: branchLabel, from: fromRoute, steps: [step] }],
	};
}

/** Drop the last step of a row. A branch emptied by it is removed whole —
 *  a branch with no steps is the engine's refusal, not a state. */
export function removeLast(body: FlowBody, lane: LaneRef): FlowBody {
	if (lane.kind === "trunk") return { ...body, steps: body.steps.slice(0, -1) };
	const shorter = body.branches.map((branch, index) =>
		index === lane.index ? { ...branch, steps: branch.steps.slice(0, -1) } : branch,
	);
	return { ...body, branches: shorter.filter((branch) => branch.steps.length > 0) };
}

/** Whether a branch forks from the trunk step at `position` — removing that
 *  step would orphan the branch, which the engine refuses. */
export function isForkPoint(flow: Flow, position: number): boolean {
	return flow.branches.some((branch) => branch.from === position);
}

/**
 * The trunk position a fork from `route` actually resolves to: the FIRST
 * occurrence — the engine's rule (`flows.rs` resolves `from` by
 * `position()`), surfaced so the board can say when a repeated route makes
 * the drawn fork differ from the clicked one.
 */
export function forkResolvesTo(flow: Flow, route: string): number {
	return flow.steps.findIndex((step) => step.route === route);
}

/** A mirror link's route: same-origin → its path. Anything else — another
 *  origin, `mailto:`, an unparsable href — is not a screen of this app. */
export function routeOfHref(href: string | null, origin: string): string | null {
	if (!href) return null;
	try {
		const url = new URL(href, origin);
		return url.origin === origin ? url.pathname : null;
	} catch {
		return null;
	}
}

/** Whether the (freshly hot-reloaded) flow already holds the step a pending
 *  card wrote — the signal to retire the card instead of drawing both. */
export function hasStepAt(flow: Flow, at: ComposerTarget, route: string): boolean {
	if (at.fork) {
		// The engine forks from the FIRST occurrence of the route; a fork
		// authored on a later occurrence lands there, and matching `at.after`
		// literally left the card waiting for a branch that will never say so.
		const from = forkResolvesTo(flow, flow.steps[at.after]?.route ?? "");
		return flow.branches.some((branch) => branch.from === from && branch.steps[0]?.route === route);
	}
	if (at.lane.kind === "trunk") return flow.steps[at.after + 1]?.route === route;
	return flow.branches[at.lane.index]?.steps[at.after + 1]?.route === route;
}

/** A card's draft as one wire step: trimmed, empty extras omitted. The
 *  viewport is the one the step it follows pinned — empty when that step
 *  follows the default, so the new step follows it too. */
export function stepInputOf(
	draft: { route: string; label: string; spec: string; via: string },
	viewport: string,
): FlowStepInput {
	const step: FlowStepInput = { route: draft.route.trim() };
	if (viewport) step.viewport = viewport;
	const label = draft.label.trim();
	if (label) step.label = label;
	const via = draft.via.trim();
	if (via) step.via = via;
	const spec = draft.spec.trim();
	if (spec) step.spec = spec;
	return step;
}
