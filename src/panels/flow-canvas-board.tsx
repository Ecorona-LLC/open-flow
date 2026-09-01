"use client";

import {
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { CanvasDetailContext, type CanvasDetail } from "../canvas-gestures";
import { useManifest } from "../config-context";
import {
	CanvasChrome,
	FlowCanvas,
	type CanvasEdgeProp,
	type CanvasNode,
	type CanvasViewport,
} from "../flow-canvas";
import { cx } from "../cx";
import {
	atCap,
	forkResolvesTo,
	isForkPoint,
	laneRefOf,
	refKey,
	type ComposerTarget,
} from "../flow-edit";
import { frameOf, type Frames } from "../flow-frames";
import {
	cardBoxOf,
	forkCardKey,
	graphOf,
	layoutGraph,
	projectEdges,
	tailKeyOf,
	type TailSpec,
} from "../flow-graph";
import { laneKey, locateNode, type Lane, type StepNode } from "../flow-layout";
import { MirrorFrame, RouteFrame, type MirrorPick } from "../frame";
import { frameUrl } from "../manifest";
import type { Flow, Viewport } from "../manifest.types";
import { ScreenFrame } from "../screen-frame";
import { NodeMenu } from "../node-menu";
import { AT_CAP, EN_CURSO } from "../journey-acts";
import { nodeActions, type NodeAction, type NodeFrame } from "../node-actions";
import { CHIP } from "../screen-toolbar";
import {
	GhostChip,
	NewScreenCard,
	SketchCard,
	SpecCard,
	Stage,
	TailPlaceholder,
	type CardDraft,
	type CardStatus,
} from "./flow-cards";

/**
 * The Flujos board as a graph on the canvas: every screen is a node placed by
 * `flow-graph`, every arrow is an edge with its «vía» on the curve, and one
 * `FlowCanvas` pans and zooms the lot.
 *
 * This module owns the translation and nothing else. The panel's machinery —
 * the frames ledger, the sweep, the composer state — arrives through the same
 * props the row board took, still keyed by `StepNode.key`; the canvas keys
 * merely SUFFIX the slot (`…:0`, `…:1`), so the split theme is two offset
 * subtrees of one canvas while the ledger and the composer keep speaking raw
 * keys and captures stay in slot 0.
 *
 * Node cells render at natural size (`ScreenFrame scale={1}`) — the canvas'
 * single viewport transform does all scaling, which is why chips and captions
 * here are set in world pixels large enough to read at fit.
 */

/**
 * Chrome that only exists when the canvas is close enough for it to be worth
 * reading. It consumes the context rather than taking a prop because the
 * board BUILDS its nodes outside the canvas and they RENDER inside it — this
 * is the one place that distinction is visible.
 */
function NearOnly({ children, always = false }: { children: ReactNode; always?: boolean }) {
	// `always` is for a screen that is a LIVE document. Its frame is a real
	// iframe at every zoom (unmounting a capture in flight restarts the sweep),
	// so the mirror's right-click forwarding — deliberately mirrors-only, since
	// intercepting a real app's gestures would be the workbench lying about
	// what the page does — never runs on it, and hiding its chips at a far zoom
	// left «Volver a espejo» unreachable without zooming in first. Usually that
	// is one screen and costs the far view nothing; a board where several steps
	// went `restless` gets a chip row under each of them, which is the price of
	// their being reachable at all.
	return useContext(CanvasDetailContext) === "near" || always ? <>{children}</> : null;
}

/**
 * Picks what a node shows for the distance the canvas is at.
 *
 * A component rather than a board-level `if` for the same reason `NearOnly` is
 * one: the board BUILDS these elements outside the canvas and they RENDER
 * inside it, so the detail is only knowable here.
 *
 * Crossing the threshold does unmount the branch it leaves — going far drops
 * every mirror, and coming back re-parses their `srcdoc`s in one commit. That
 * burst is bounded by what `near` already costs steadily, and it buys zero
 * live documents at a fitted zoom. A LIVE document never passes through here
 * at all; see the call site for why that one must not be swapped.
 */
function AtDetail({ far, near }: { far: ReactNode; near: ReactNode }) {
	return <>{useContext(CanvasDetailContext) === "far" ? far : near}</>;
}

function hora(timestamp: number): string {
	return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Everything the board needs to draw and drive the composer. Bundled so the
 *  presence of ONE prop says "this board can grow the journey". */
export interface BoardComposer {
	/** The open card, already gated for the retire-on-arrival paint. */
	card: { at: ComposerTarget; draft: CardDraft; status: CardStatus } | null;
	cardViewport: Viewport | null;
	routesList: string;
	/** A write is in flight somewhere; every gesture waits its turn. */
	busy: boolean;
	onDraft: (changes: Partial<CardDraft>) => void;
	onSubmit: () => void;
	onCancelCard: () => void;
	onGhost: (
		lane: ReturnType<typeof laneRefOf>,
		after: number,
		flat: number,
		anchorRoute: string,
	) => void;
	onFork: (position: number, flat: number, anchorRoute: string) => void;
	onRemove: (lane: ReturnType<typeof laneRefOf>) => void;
	/** Whether mirrors offer the connect gesture (off while Editar pins). */
	connect: boolean;
	onPick: (node: StepNode, pick: MirrorPick | null) => void;
	onHoverPick: (node: StepNode, pick: MirrorPick | null) => void;
}

/** Vertical gap between the light and dark subtrees in split. */
const SPLIT_GAP = 200;

/**
 * A band's tint. Barely there on purpose — a section says "these screens
 * belong together", and anything louder competes with the screens themselves.
 * The trunk is neutral; branches cycle, so adjacent bands differ (a fourth
 * sibling wears the first's tone again — the border and the label carry the
 * identity, the fill only groups).
 */
const SECTION_TONES = [
	{
		box: "border-zinc-950/10 bg-zinc-950/[0.03] dark:border-white/10 dark:bg-white/[0.03]",
		text: "text-zinc-500 dark:text-zinc-400",
	},
	{ box: "border-sky-500/25 bg-sky-500/[0.04]", text: "text-sky-700 dark:text-sky-300" },
	{
		box: "border-violet-500/25 bg-violet-500/[0.08] dark:bg-violet-500/[0.08]",
		text: "text-violet-700 dark:text-violet-300",
	},
	{
		box: "border-emerald-500/25 bg-emerald-500/[0.04] dark:bg-emerald-500/[0.08]",
		text: "text-emerald-700 dark:text-emerald-300",
	},
] as const;

export function CanvasBoard({
	flow,
	lanes,
	themes,
	nonce,
	editing,
	frames,
	active,
	fitKey,
	shape,
	onCapture,
	onActivate,
	onRefresh,
	onDemote,
	registerLiveFrame,
	composer,
	onViewportChange,
	onDetailChange,
}: {
	flow: Flow;
	lanes: Lane[];
	/** One subtree per entry; index is the slot. Slot 0 is the sweep's board:
	 *  captures happen there, never in the split twin. */
	themes: Array<"light" | "dark">;
	nonce: number;
	editing: boolean;
	frames: Frames;
	active: { key: string; slot: number } | null;
	/** Changing this refits the canvas (device preset, theme layout). */
	fitKey: string;
	/** The panel's own `StepNode.key` join — passed, never re-derived, so the
	 *  reveal cannot disagree with the ledger about what the journey is. */
	shape: string;
	onCapture: (key: string, ticket: number, frame: HTMLIFrameElement) => void;
	onActivate: (key: string, slot: number) => void;
	onRefresh: (key: string) => void;
	onDemote: () => void;
	registerLiveFrame: (key: string, slot: number, frame: HTMLIFrameElement | null) => void;
	composer: BoardComposer | null;
	/** Fires on every pan/zoom tick — the panel closes its fixed overlays here. */
	onViewportChange: (viewport: CanvasViewport) => void;
	/** Fires when the canvas crosses the detail threshold — a flip remounts
	 *  every mirror, so anything instrumenting iframes must re-attach. */
	onDetailChange: (detail: CanvasDetail) => void;
}) {
	const { config } = useManifest();

	/** The journey is full: every surface that offers to grow it must say so,
	 *  not just the one that asks `nodeActions`. */
	const full = atCap(flow, config.maxFlowSteps);

	const card = composer?.card ?? null;
	const cardViewport = composer?.cardViewport ?? null;

	/** The right-click menu over a screen: where it was summoned, and the KEY of
	 *  the screen that summoned it — never the lane and node objects. Held by
	 *  identity so the rows are recomputed from the live journey on every
	 *  render: a rescan under an open menu would otherwise leave «Quitar la
	 *  pantalla» pointing at a position that has moved, and remove the wrong
	 *  screen. */
	const [menuAt, setMenuAt] = useState<{
		at: { x: number; y: number };
		key: string;
		slot: number;
	} | null>(null);

	/** A screen's frame, as `nodeActions` asks about it. */
	const frameKindOf = (node: StepNode, slot: number): NodeFrame => {
		const state = frameOf(frames, node);
		if (active !== null && active.key === node.key && active.slot === slot) return "live";
		if (state.kind === "mirrored") return "mirrored";
		if (state.kind === "restless") return "restless";
		if (state.kind === "unbuilt") return "unbuilt";
		return "loading";
	};

	const situationOf = (lane: Lane, node: StepNode, position: number, slot: number) => ({
		frame: frameKindOf(node, slot),
		lane: lane.kind,
		isLast: position === lane.nodes.length - 1,
		isForkPoint: lane.kind === "trunk" && isForkPoint(flow, position),
		// A branch may be emptied — it is removed whole. The trunk may not: a
		// journey with no screens is not a journey.
		removable: lane.kind === "branch" || lane.nodes.length > 1,
		canEdit: composer !== null,
		atCap: full,
	});

	// Re-resolved every render, so the rows follow the live journey.
	const menuOn = menuAt && locateNode(lanes, menuAt.key);
	const menuNode = menuOn?.lane.nodes[menuOn.position] ?? null;
	const menuContents =
		menuAt && menuOn && menuNode
			? nodeActions(situationOf(menuOn.lane, menuNode, menuOn.position, menuAt.slot))
			: null;

	// Closed, not merely un-rendered: a rescan that drops the key and a later
	// one that restores it would otherwise resurrect the menu at a pointer the
	// person left minutes ago. Same reason the panel clears its popover on a
	// reshape.
	useEffect(() => {
		setMenuAt((open) => (open === null ? open : null));
	}, [shape, nonce]);

	/** A screen was right-clicked away from any control. */
	const openMenu = (node: StepNode, slot: number, at: { x: number; y: number }) => {
		// One floating box at a time: the popover and the menu share a z-index,
		// and only a browser-timing accident (focus entering the mirror blurs
		// the window) was closing the popover first.
		composer?.onPick(node, null);
		setMenuAt({ at, key: node.key, slot });
	};

	/** Every surface runs an action through here — the chips, the menu — so
	 *  "the same handler" is literally the same call. */
	const runAction = (
		action: NodeAction,
		where: { lane: Lane; node: StepNode; position: number; slot: number },
	) => {
		const { lane, node, position, slot } = where;
		if (action.blocked !== null) return;
		if (action.edits && composer && (composer.busy || composer.card !== null)) return;
		switch (action.id) {
			case "demote":
				onDemote();
				break;
			case "activate":
				onActivate(node.key, slot);
				break;
			case "refresh":
				onRefresh(node.key);
				break;
			case "append":
				composer?.onGhost(laneRefOf(lane), position, node.flat, node.step.route);
				break;
			case "fork":
				composer?.onFork(position, node.flat, node.step.route);
				break;
			case "remove":
				composer?.onRemove(laneRefOf(lane));
				break;
		}
	};

	// What the composer appends to the graph: a ghost (or the open card) at
	// every row's tail, and the fork card's own band while a branch is being
	// authored. Sizes are the BOX the canvas reserves, so they must match what
	// the cells below actually draw.
	// `canCompose`, not `composer`: the panel rebuilds that object every
	// render (a keystroke into the card, a ledger tick), and only its
	// PRESENCE decides whether tails exist — depending on the object made
	// the memo below re-lay the whole graph on every keypress.
	const canCompose = composer !== null;
	const tails = useMemo((): TailSpec | undefined => {
		if (!canCompose) return undefined;
		// Only the OPEN card takes world room. «+ Añadir pantalla» is a
		// constant-size chip drawn as chrome after a lane's last screen.
		const tail = new Map<string, { width: number; height: number }>();
		if (card && !card.at.fork && cardViewport) {
			tail.set(refKey(card.at.lane), cardBoxOf(cardViewport));
		}
		return {
			tail,
			forkCard:
				card?.at.fork && cardViewport
					? {
							fork: card.at.flat,
							...cardBoxOf(cardViewport),
							label: card.draft.branchLabel.trim() || "nueva rama",
						}
					: null,
		};
	}, [canCompose, lanes, card, cardViewport]);

	const {
		graph,
		positions,
		bands: placements,
		bbox,
	} = useMemo(() => {
		const built = graphOf(lanes, tails);
		return { graph: built, ...layoutGraph(built) };
	}, [lanes, tails]);
	/** Which tone each band wears — the trunk is 0, branches cycle from 1. */
	const bandTone = useMemo(() => {
		const tones = new Map<string, number>();
		let next = 0;
		for (const band of placements) {
			if (band.laneKey === laneKey(null)) continue;
			tones.set(band.laneKey, 1 + (next % (SECTION_TONES.length - 1)));
			next += 1;
		}
		return tones;
	}, [placements]);
	const projected = useMemo(() => projectEdges(graph, positions), [graph, positions]);

	/* ------------------------------------------------------------- reveal */
	// A gesture that grows the board should also show its result: the card
	// pans into view when it opens, and the step that just landed pans into
	// view when the rescan delivers it.
	// A tick, not just a key: re-adding a screen that was just removed asks
	// for the SAME key, and a bare string would bail out of the state update
	// and never pan.
	const [reveal, setReveal] = useState<{ key: string; tick: number } | null>(null);
	const tick = useRef(0);
	const aim = useCallback((key: string) => {
		tick.current += 1;
		setReveal({ key: `${key}:0`, tick: tick.current });
	}, []);
	const cardKey = card
		? card.at.fork
			? forkCardKey(card.at.flat)
			: tailKeyOf(refKey(card.at.lane))
		: null;
	useEffect(() => {
		if (cardKey) aim(cardKey);
		else setReveal(null);
	}, [cardKey, aim]);
	const previousKeys = useRef<string | null>(null);
	useEffect(() => {
		const prev = previousKeys.current;
		previousKeys.current = shape;
		if (prev === null || prev === shape) return;
		const before = new Set(prev.split("|"));
		const now = new Set(shape.split("|"));
		const added = [...now].filter((key) => key && !before.has(key));
		const removed = [...before].filter((key) => key && !now.has(key));
		// A composed screen ADDS one key and removes none. A rescan that renames
		// one step also adds exactly one — and removes one, which is how the
		// camera stays put instead of yanking to a step nobody composed.
		if (added.length === 1 && removed.length === 0 && added[0]) aim(added[0]);
	}, [shape, aim]);

	/* -------------------------------------------------------------- cells */

	const stepCell = (node: StepNode, slot: number, theme: "light" | "dark"): ReactNode => {
		const { step, viewport } = node;
		const state = frameOf(frames, node);
		const isActive = active !== null && active.key === node.key && active.slot === slot;
		const capturingTicket = state.kind === "capturing" ? state.ticket : null;
		const capturingHere = capturingTicket !== null && slot === 0;
		// A restless step stays live in the sweep's board only — a second live
		// copy in the split twin would double exactly the load the mirrors
		// exist to avoid.
		const live = isActive || (state.kind === "restless" && slot === 0) || capturingHere;
		return (
			<>
				{/* The vía rides the EDGE, and the edge layer is aria-hidden — so
				    the one authored fact a step adds would be silent. Said here,
				    in step order, exactly as the row board's arrow caption did. */}
				{step.via && <span className="sr-only">Vía «{step.via}»</span>}
				<ScreenFrame
					viewport={viewport}
					scale={1}
					bare
					editing={editing && state.kind !== "unbuilt"}
				>
					{/* A live document is NEVER swapped for a card. Unmounting a
				    capture in flight loses its `load`, so `onCapture` never runs,
				    the step sits `capturing`, and `nextCapture` blocks the whole
				    sweep until the 30 s watchdog calls it restless — one press of
				    «Ajustar» mid-sweep would have cost a ten-step flow 300 s and
				    left ten blank cards. Distance decides what a SETTLED step
				    draws, never whether a live one exists. */}
					{live ? (
						<RouteFrame
							key={nonce}
							src={step.route}
							title={`${flow.title} · ${step.label}`}
							width={viewport.width}
							height={viewport.height}
							theme={theme}
							frameRef={(element) => registerLiveFrame(node.key, slot, element)}
							onLoad={
								capturingHere && capturingTicket !== null
									? (frame) => onCapture(node.key, capturingTicket, frame)
									: undefined
							}
						/>
					) : (
						/* Far away the canvas draws the page's SHAPE, not the page: a
						   real document at an eighth of its size is mush, and an
						   iframe per screen is an iframe per screen. At fit that is
						   zero live documents instead of twenty. */
						<AtDetail
							far={
								<SketchCard
									viewport={viewport}
									theme={theme}
									sketch={state.kind === "mirrored" ? state.sketch : null}
									tone={state.kind === "unbuilt" ? "unbuilt" : "mirror"}
								/>
							}
							near={
								state.kind === "unbuilt" ? (
									<SpecCard step={step} viewport={viewport} theme={theme} />
								) : state.kind === "mirrored" ? (
									<MirrorFrame
										srcdoc={state.srcdoc}
										title={`${flow.title} · ${step.label} (espejo)`}
										width={viewport.width}
										height={viewport.height}
										theme={theme}
										connect={
											// `composer.connect` is already `!editing`.
											composer?.connect
												? {
														busy: composer.busy || composer.card !== null,
														onPick: (pick) => composer.onPick(node, pick),
														onHover: (pick) => composer.onHoverPick(node, pick),
													}
												: undefined
										}
										onMenu={(at) => openMenu(node, slot, at)}
									/>
								) : (
									<Stage
										viewport={viewport}
										theme={theme}
										className="flex items-center justify-center"
									>
										<p className="max-w-lg px-10 text-center text-2xl leading-relaxed text-zinc-400 dark:text-zinc-500">
											{state.kind === "capturing"
												? "Cargando la ruta real…"
												: state.kind === "restless"
													? "Sin espejo — el paso sigue en vivo en el tablero claro."
													: "En cola — cada paso se carga una sola vez y queda como espejo."}
										</p>
									</Stage>
								)
							}
						/>
					)}
				</ScreenFrame>
			</>
		);
	};

	/**
	 * A screen's chrome: its name above, its controls below — all of it at a
	 * constant size on screen, like a Figma frame name, because at «Ajustar» a
	 * 390px screen is 100px wide and 11px world type is under two device
	 * pixels. The name is always drawn; the rest waits until the canvas is
	 * close enough that it would not be a smear.
	 */
	const stepChrome = (
		lane: Lane,
		node: StepNode,
		position: number,
		slot: number,
		theme: "light" | "dark",
	): ReactNode => {
		const { step, viewport } = node;
		const state = frameOf(frames, node);
		const isActive = active !== null && active.key === node.key && active.slot === slot;
		const capturingHere = state.kind === "capturing" && slot === 0;
		// The chip row shows what has chip words; `append` deliberately has none
		// — the lane-tail ghost chip owns that gesture, anchored where the new
		// screen will appear.
		const actions = nodeActions(situationOf(lane, node, position, slot)).actions.filter(
			(action): action is NodeAction & { chip: string } => action.chip !== null,
		);
		return (
			<>
				<CanvasChrome anchor="bottom left" clamp style={{ bottom: "100%" }}>
					<p
						title={`${node.number}. ${step.label} · ${step.route}`}
						className={cx(
							"flex items-baseline gap-1.5 overflow-hidden whitespace-nowrap pb-1 text-[11px] font-medium",
							state.kind === "unbuilt"
								? "text-amber-700 dark:text-amber-300"
								: isActive
									? "text-emerald-600 dark:text-emerald-400"
									: "text-zinc-600 dark:text-zinc-300",
						)}
					>
						<span className="shrink-0 truncate">
							{node.number}. {step.label}
						</span>
						<NearOnly>
							<span className="min-w-0 truncate font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
								{step.route} · {viewport.label} {viewport.width}×{viewport.height}
							</span>
						</NearOnly>
					</p>
				</CanvasChrome>
				<NearOnly always={isActive || state.kind === "restless" || capturingHere}>
					<CanvasChrome clamp style={{ top: "100%" }}>
						{(isActive ||
							state.kind === "mirrored" ||
							state.kind === "restless" ||
							state.kind === "unbuilt" ||
							capturingHere) && (
							<div className="mt-2 flex flex-wrap items-center gap-2">
								{state.kind === "unbuilt" ? (
									<span
										className="text-[11px] text-amber-700 dark:text-amber-300"
										title="La ruta no existe todavía; el cuadro muestra la especificación. Se vuelve un espejo real en el siguiente `workbench scan` después de que la página aterrice."
									>
										Sin página todavía
									</span>
								) : isActive ? (
									<span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
										En vivo
									</span>
								) : state.kind === "mirrored" ? (
									<span
										className="text-[11px] text-zinc-500 dark:text-zinc-400"
										title="Espejo estático de la página real — sin peticiones al servidor."
									>
										Espejo · {hora(state.capturedAt)}
									</span>
								) : state.kind === "restless" ? (
									<span
										className="text-[11px] text-amber-700 dark:text-amber-300"
										title="La página no terminó de asentarse, así que el cuadro sigue en vivo."
									>
										En vivo — sin espejo
									</span>
								) : (
									<span className="text-[11px] text-zinc-500 dark:text-zinc-400">Cargando…</span>
								)}
								{actions.map((action) => {
									const waiting =
										action.edits && composer !== null && (composer.busy || composer.card !== null);
									const off = action.blocked ?? (waiting ? EN_CURSO : null);
									// `aria-disabled`, not `disabled`, for BOTH refusals: the
									// SENTENCE is the point, and a browser fires no hover on a
									// `disabled` button, so its tooltip never appeared at all.
									// The reason rides `aria-label` too — as a bare `title` on
									// a control whose name is "quitar" it is read
									// inconsistently, and the menu already announces it.
									return off !== null ? (
										<button
											key={action.id}
											type="button"
											className={cx(CHIP, "opacity-40")}
											aria-disabled="true"
											aria-label={`${action.chip} — ${off}`}
											onClick={() => {}}
											title={off}
										>
											{action.chip}
										</button>
									) : (
										<button
											key={action.id}
											type="button"
											className={CHIP}
											onClick={() => runAction(action, { lane, node, position, slot })}
											title={action.title}
										>
											{action.chip}
										</button>
									);
								})}
							</div>
						)}
						<div className="mt-2 flex items-start justify-between gap-2">
							<div className="flex min-w-0 flex-col gap-1">
								{step.note && (
									<p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
										{step.note}
									</p>
								)}
								{step.notice && (
									// The scan's own remark, drawn as the scan's: it is not the
									// author's caption and no longer pretends to be by riding
									// in the same field.
									<p className="text-[11px] leading-snug text-amber-700 dark:text-amber-300">
										{step.notice}
									</p>
								)}
							</div>
							<span className="ml-auto flex shrink-0 items-center gap-2">
								{state.kind !== "unbuilt" ? (
									<>
										<a
											href={step.route}
											target="_blank"
											rel="noreferrer"
											className="font-mono text-[11px] text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
										>
											{step.route} ↗
										</a>
										<a
											href={frameUrl(config, {
												route: step.route,
												viewport: viewport.id,
												theme,
											})}
											target="_blank"
											rel="noreferrer"
											className="text-[11px] text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
										>
											aislado ↗
										</a>
									</>
								) : (
									// No link to a page that is not there.
									<span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
										{step.route}
									</span>
								)}
							</span>
						</div>
					</CanvasChrome>
				</NearOnly>
			</>
		);
	};

	const cardCell = (slot: number, theme: "light" | "dark", fork: boolean): ReactNode => {
		if (!card || !cardViewport || !composer) return null;
		return (
			<ScreenFrame viewport={cardViewport} scale={1} bare>
				{slot === 0 ? (
					<NewScreenCard
						viewport={cardViewport}
						theme={theme}
						fork={fork}
						routesList={composer.routesList}
						draft={card.draft}
						status={card.status}
						onDraft={composer.onDraft}
						onSubmit={composer.onSubmit}
						onCancel={composer.onCancelCard}
					/>
				) : (
					<TailPlaceholder
						viewport={cardViewport}
						theme={theme}
						writing={card.status === "writing"}
					/>
				)}
			</ScreenFrame>
		);
	};

	/* --------------------------------------------- nodes & edges per slot */

	const boxOf = useMemo(() => new Map(graph.nodes.map((node) => [node.key, node])), [graph]);
	const split = themes.length > 1;
	// Slot 1 sits below everything slot 0 draws, captions included.
	const slotOffset = bbox.maxY - Math.min(bbox.minY, 0) + SPLIT_GAP;

	const nodes: CanvasNode[] = [];
	const edges: CanvasEdgeProp[] = [];
	for (const [slot, theme] of themes.entries()) {
		const dy = slot * slotOffset;
		if (split) {
			nodes.push({
				key: `theme:${slot}`,
				x: bbox.minX,
				y: bbox.minY + dy,
				width: 400,
				height: 1,
				// Decoration, not a screen: `openViewport` measures the first real
				// node to decide how far to back off, and a 400×1 label made it
				// think everything fit.
				behind: true,
				element: null,
				chrome: (
					<CanvasChrome anchor="bottom left" style={{ bottom: "100%" }}>
						<p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
							{theme === "light" ? "Claro" : "Oscuro"}
						</p>
					</CanvasChrome>
				),
			});
		}
		// Sections first, so a band's tint sits behind everything it holds.
		for (const band of placements) {
			const tone = SECTION_TONES[bandTone.get(band.laneKey) ?? 0] ?? SECTION_TONES[0];
			nodes.push({
				key: `section:${band.laneKey}:${slot}`,
				x: band.section.x,
				y: band.section.y + dy,
				width: band.section.width,
				height: band.section.height,
				behind: true,
				element: <div className={cx("h-full w-full rounded-2xl border", tone.box)} />,
				chrome: (
					<CanvasChrome anchor="bottom left" clamp style={{ bottom: "100%", left: 4 }}>
						<p
							// Truncated, not unclamped: a caption free to grow past its
							// own section overprints the band beside it, and a label you
							// cannot read beats two you cannot separate. The full text is
							// in the tooltip, on the edge at `near`, and in the sr-only
							// «vía» each step already carries.
							title={band.label ?? "Tronco"}
							className={cx("truncate whitespace-nowrap pb-1 text-[11px] font-medium", tone.text)}
						>
							{band.label ?? "Tronco"}
						</p>
					</CanvasChrome>
				),
			});
		}
		for (const lane of lanes) {
			const key = laneKey(lane.kind === "trunk" ? null : lane.id);
			for (const [position, stepNode] of lane.nodes.entries()) {
				const at = positions.get(stepNode.key);
				const box = boxOf.get(stepNode.key);
				if (!at || !box) continue;
				const state = frameOf(frames, stepNode);
				nodes.push({
					key: `${stepNode.key}:${slot}`,
					x: at.x,
					y: at.y + dy,
					width: box.box.width,
					height: box.box.height,
					// A node holding a LIVE document is never display-locked:
					// content-visibility on an offscreen capture throttles the
					// rAF and observer traffic `whenQuiet` is waiting for, and a
					// capture that never settles goes restless — which leaves the
					// frame live, exactly the pile-up mirrors exist to prevent.
					alwaysRender:
						state.kind === "capturing" ||
						state.kind === "restless" ||
						(active?.key === stepNode.key && active.slot === slot),
					element: stepCell(stepNode, slot, theme),
					onContextMenu: (at) => openMenu(stepNode, slot, at),
					chromeLabel: `${stepNode.number}. ${stepNode.step.label} · ${stepNode.step.route}`,
					chrome: stepChrome(lane, stepNode, position, slot, theme),
				});
			}
			const tail = tails?.tail.get(key);
			const last = lane.nodes[lane.nodes.length - 1];
			const tailKey = tailKeyOf(key);
			const cardAt = tail ? positions.get(tailKey) : undefined;
			if (tail && cardAt && composer) {
				nodes.push({
					key: `${tailKey}:${slot}`,
					x: cardAt.x,
					y: cardAt.y + dy,
					width: tail.width,
					height: tail.height,
					// The card owns focus and a live draft; locking it would fight
					// the autofocus the reveal just panned to.
					alwaysRender: true,
					element: cardCell(slot, theme, false),
				});
			} else if (composer) {
				// No card open on this lane: the chip that would open one hangs
				// off the last screen as chrome, costing the layout nothing. A
				// hand-edited EMPTY lane still gets it, anchored to its band —
				// losing the only control that could grow it made "broken" read
				// as "read-only".
				const band = placements.find((candidate) => candidate.laneKey === key);
				const at = last ? positions.get(last.key) : band && { x: band.x, y: band.y };
				const box = last ? boxOf.get(last.key) : undefined;
				if (at) {
					nodes.push({
						key: `add:${key}:${slot}`,
						x: at.x + (box?.box.width ?? 0),
						y: at.y + dy,
						width: 1,
						height: box?.box.height ?? 1,
						element: null,
						chrome: (
							<NearOnly>
								<CanvasChrome anchor="bottom left" style={{ top: "50%", left: 12 }}>
									<GhostChip
										label="+ Añadir pantalla"
										// `nodeActions` gives `append` no chip words because
										// THIS is the append affordance — so the cap has to
										// be refused here, or the one surface that owns the
										// gesture is the one that never mentions it.
										disabled={composer.busy || composer.card !== null || full}
										reason={full ? AT_CAP : undefined}
										onOpen={() =>
											composer.onGhost(
												laneRefOf(lane),
												lane.nodes.length - 1,
												// An empty lane submits an empty anchor and the
												// engine refuses it by name — better than a lane
												// with no way to grow at all.
												last?.flat ?? 0,
												last?.step.route ?? "",
											)
										}
									/>
								</CanvasChrome>
							</NearOnly>
						),
					});
				}
			}
		}
		if (tails?.forkCard && card) {
			const forkKey = forkCardKey(tails.forkCard.fork);
			const at = positions.get(forkKey);
			const box = boxOf.get(forkKey);
			if (at && box) {
				const repeats =
					forkResolvesTo(flow, flow.steps[card.at.after]?.route ?? "") !== card.at.after;
				nodes.push({
					key: `${forkKey}:${slot}`,
					x: at.x,
					y: at.y + dy,
					width: box.box.width,
					height: box.box.height,
					alwaysRender: true,
					element: cardCell(slot, theme, true),
					chrome: repeats ? (
						// The section above already names the branch; this is the
						// one thing it cannot say.
						<CanvasChrome anchor="bottom left" style={{ bottom: "100%" }}>
							<p className="max-w-[26rem] text-[11px] leading-snug text-amber-700 dark:text-amber-300">
								El tronco repite esta ruta; el motor dibuja la rama desde su primera aparición.
							</p>
						</CanvasChrome>
					) : undefined,
				});
			}
		}
		for (const edge of projected) {
			edges.push({
				...edge,
				id: `${edge.id}:${slot}`,
				from: { x: edge.from.x, y: edge.from.y + dy },
				to: { x: edge.to.x, y: edge.to.y + dy },
				// The gutter belongs to THIS subtree. Left at slot 0's y, the
				// dark twin's fork arrows looped up through the light board.
				...(edge.waypoints
					? { waypoints: edge.waypoints.map((point) => ({ x: point.x, y: point.y + dy })) }
					: {}),
			});
		}
	}

	// The graph's bbox already counts every section; the board only adds the
	// second subtree's offset.
	const canvasBbox = {
		minX: bbox.minX,
		minY: bbox.minY,
		maxX: bbox.maxX,
		maxY: bbox.maxY + (themes.length - 1) * slotOffset,
	};

	const canvas = (
		<FlowCanvas
			nodes={nodes}
			edges={edges}
			bbox={canvasBbox}
			fitKey={fitKey}
			reveal={reveal}
			onViewportChange={(viewport) => {
				// The canvas pans and zooms by CSS transform, which fires no
				// scroll and no resize — so `useFloating`'s dismissals never hear
				// it, and a fixed menu would sit over a screen that has moved out
				// from under it (and, past the detail threshold, unmounted). The
				// popover is closed for exactly this reason in `flows.tsx`.
				// Functional and null-checked, so a 60 Hz pan with nothing open
				// schedules no render.
				setMenuAt((open) => (open === null ? open : null));
				onViewportChange(viewport);
			}}
			onDetailChange={onDetailChange}
			label={`Lienzo del recorrido ${flow.title}`}
			className="bg-zinc-50 [--wb-canvas-bg:#fafafa] dark:bg-zinc-950 dark:[--wb-canvas-bg:#09090b]"
		/>
	);

	// Outside the canvas: `position: fixed`, so it must not inherit the
	// viewport transform.
	return (
		<>
			{canvas}
			{menuAt && menuOn && menuNode && menuContents && (
				<NodeMenu
					title={`${menuNode.number}. ${menuNode.step.label}`}
					at={{ top: menuAt.at.y, left: menuAt.at.x }}
					actions={menuContents.actions}
					note={menuContents.note}
					busy={composer !== null && (composer.busy || composer.card !== null)}
					onRun={(action) => {
						setMenuAt(null);
						runAction(action, {
							lane: menuOn.lane,
							node: menuNode,
							position: menuOn.position,
							slot: menuAt.slot,
						});
					}}
					onClose={() => setMenuAt(null)}
				/>
			)}
		</>
	);
}
