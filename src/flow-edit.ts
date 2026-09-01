import { laneKey, type Lane } from "./flow-layout";
import {
	APPEND,
	AT_CAP,
	CLICK,
	FORK,
	NOWHERE,
	ONLY_AT_THE_END,
	ONLY_FROM_TRUNK,
	RIGHT_CLICK,
	type JourneyAct,
} from "./journey-acts";
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
 * Three chosen costs of the same corollary, because the manifest cannot tell
 * an authored value from a derived one:
 *
 * 1. A step's `label_for`-derived label is re-sent as if authored and lands in
 *    the config on the first edit. Redundant, never false.
 * 2. The default viewport WOULD drift behaviourally, so it is elided instead
 *    (`bodyOf` takes the default and omits matches) and a step that never
 *    pinned a viewport keeps following the config's.
 * 3. The scan's own remark about a step no longer travels at all. It used to
 *    be CONCATENATED onto the last shown step's `note` by both trims in
 *    `flows.rs`, so `stepBody`'s `note: or(step.note)` wrote «Se declararon 14
 *    pasos; se muestran los primeros 12.» into `workbench.config.json` as an
 *    authored caption, where it outlived the trim it described and collected a
 *    second copy on the next scan. `FlowStep.notice` is now a separate derived
 *    field: the board draws it and never sends it back. Stripping the sentence
 *    HERE would have been the hand-synchronised duplication this package
 *    refuses, which is why the repair belonged in the engine.
 */

/** The row a gesture addresses: the trunk, or a branch by its position. */
export type LaneRef = { kind: "trunk" } | { kind: "branch"; index: number; id: string };

/** The lane a board row addresses on the wire. */
export function laneRefOf(lane: Lane): LaneRef {
	return lane.kind === "trunk"
		? { kind: "trunk" }
		: { kind: "branch", index: lane.index, id: lane.id };
}

/** The row half of a ref's key, matching `StepNode.key`'s prefix. */
export function refKey(ref: LaneRef): string {
	return laneKey(ref.kind === "trunk" ? null : ref.id);
}

/**
 * Where a new screen lands. For a fork, `lane` is the trunk and `after` the
 * step the new branch leaves from; otherwise the card follows `after` in its
 * own lane (always the last step — mid-row inserts would re-key every column
 * to the right and re-sweep it).
 */
export interface ComposerTarget {
	lane: LaneRef;
	/** Position within the lane of the step the new screen follows. Not used by
	 *  the write — `appendStep` always pushes to the lane's tail — so this is
	 *  load-bearing only for the anchor revalidation and the inherited
	 *  viewport. The anchor is the contract. */
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

/**
 * Every screen a journey holds, branches included — the number the engine
 * caps (`FlowInput::every_step().count()`). One writer, because a surface that
 * counted it differently would offer a screen the engine refuses, which is
 * exactly what carrying `maxFlowSteps` into the manifest was for.
 */
export function stepCount(flow: Flow): number {
	return flow.steps.length + flow.branches.reduce((total, b) => total + b.steps.length, 0);
}

/** Whether the journey may grow at all. */
export function atCap(flow: Flow, maxFlowSteps: number): boolean {
	return stepCount(flow) >= maxFlowSteps;
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

/* ------------------------------------------------- what a control can do */

/** One thing a picked control can be turned into — the shared act, so the
 *  popover, the chips and the menu cannot each hold their own words for it. */
export type ConnectAction = JourneyAct;

/** Where the picked screen sits, which is all the rule needs to know. */
export interface PickedStep {
	lane: "trunk" | "branch";
	/** Position within its own lane. */
	position: number;
	isLast: boolean;
}

export interface ConnectIntent {
	/** Legal actions, primary first. Empty when nothing can be done here. */
	actions: ConnectAction[];
	/** Why an action is missing. Shown verbatim; never assembled by a caller. */
	note: string | null;
	/** The TRUNK step this route already occupies, when it does. Branch steps
	 *  are not on this numbering — a branch step's number follows its fork
	 *  point, not the trunk's running count — so they are not reported here
	 *  rather than reported with a number that means something else. */
	existing: { number: number; label: string } | null;
}

/**
 * What the journey's SHAPE allows at this position — the one answer, which
 * every surface then dresses in its own words.
 *
 * Two surfaces ask: the popover over a clicked control (as `ConnectAction`s
 * with a hint) and the board's chips and menu (as `NodeAction`s with a chip
 * label). They used to encode this rule twice, once each, agreeing only by
 * hand — the very shape this codebase exists to make impossible, and the shape
 * that had already let `connectIntent`'s predecessor drift silently. The
 * vocabularies survive at the presentation edge; the rule does not.
 */
export function journeyMoves(
	at: { lane: "trunk" | "branch"; isLast: boolean },
	/** The journey already holds every screen the engine will accept. Part of
	 *  the ONE answer and not a per-surface afterthought: it first shipped
	 *  consulted by the right-click menu alone, so the popover and the tail
	 *  chip went on offering a screen the engine would refuse — after the
	 *  specification had been typed, which is the whole thing the cap was
	 *  carried into the manifest to prevent. */
	atCap = false,
): {
	append: boolean;
	fork: boolean;
	/** Why something is missing, said the way a person reads it. */
	why: string | null;
} {
	if (atCap) return { append: false, fork: false, why: AT_CAP };
	// A branch may leave ANY trunk step, the last one included.
	if (at.lane === "trunk") {
		return at.isLast
			? { append: true, fork: true, why: null }
			: { append: false, fork: true, why: ONLY_AT_THE_END };
	}
	if (at.isLast) return { append: true, fork: false, why: ONLY_FROM_TRUNK };
	// Mid-branch: neither is expressible. Say both reasons rather than leaving
	// a control that does nothing and explains nothing.
	return { append: false, fork: false, why: `${ONLY_AT_THE_END} ${ONLY_FROM_TRUNK}` };
}

/**
 * What clicking a control on this screen can do — the single answer every
 * surface reads.
 *
 * It used to be one line inside a React callback, which is why the gesture
 * quietly disagreed with the engine: `isLast` was tested first, so the LAST
 * trunk step could only ever append, and «Iniciar sesión» and «Crear cuenta»
 * on one screen could not become two branches — even though the engine takes
 * a branch from any trunk step and two branches from the same one
 * (`tickets.rs` requires `from` to match a trunk route; it separately requires
 * branch ids to be unique and the whole journey to fit under the step cap,
 * neither of which this rule can see).
 *
 * Pure, so the rule is testable against a manifest literal rather than a
 * browser, and so the popover, the hover label and the right-click gesture
 * cannot each hold a slightly different version of it.
 */
export function connectIntent(
	flow: Flow,
	at: PickedStep,
	route: string | null,
	atCap = false,
): ConnectIntent {
	const moves = journeyMoves(at, atCap);
	const actions: ConnectAction[] = [];
	if (moves.append) actions.push(APPEND);
	if (moves.fork) actions.push(FORK);

	const found = route === null ? -1 : flow.steps.findIndex((step) => step.route === route);
	const existing =
		found === -1 ? null : { number: found + 1, label: flow.steps[found]?.label ?? route ?? "" };

	return { actions, note: moves.why, existing };
}

/**
 * What the two mouse buttons do here, shortest form — the hover tag's second
 * line.
 *
 * Assembled here and not at the outline, because the mapping IS the rule: the
 * left button takes whatever `connectIntent` judged primary, and the right one
 * asks for a branch by name. Spelled out at the call site it was a fourth
 * place phrasing the rule, and it phrased it as one long sentence.
 */
export function connectGestures(intent: ConnectIntent): string {
	const primary = intent.actions[0];
	if (!primary) return NOWHERE;
	const parts = [`${CLICK} ${primary.verb}`];
	const fork = intent.actions.find((action) => action.kind === "fork");
	if (fork && fork !== primary) parts.push(`${RIGHT_CLICK} ${fork.verb}`);
	return parts.join(" · ");
}

/** The action a gesture asked for, if the intent allows it; else the primary. */
export function actionFor(
	intent: ConnectIntent,
	wanted: ConnectAction["kind"],
): ConnectAction | null {
	return intent.actions.find((action) => action.kind === wanted) ?? intent.actions[0] ?? null;
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
