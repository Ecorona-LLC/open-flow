"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useManifest } from "../config-context";
import { ConnectPopover, type PopoverMode } from "../connect-popover";
import { useInspect } from "../edit-mode";
import {
	appendStep,
	bodyOf,
	forkFrom,
	forkResolvesTo,
	hasStepAt,
	isForkPoint,
	removeLast,
	routeOfHref,
	stepInputOf,
	type ComposerTarget,
	type LaneRef,
} from "../flow-edit";
import { frameOf, NO_FRAMES, nextCapture, prune, withFrame, type Frames } from "../flow-frames";
import {
	forkPrefix,
	laneKey,
	layOut,
	rowExtents,
	type Lane,
	type RowTails,
	type StepNode,
} from "../flow-layout";
import { MirrorFrame, RouteFrame, type MirrorPick } from "../frame";
import type { ComponentIndex } from "../hover-inspect";
import { frameUrl, viewportById } from "../manifest";
import type { Flow, Viewport } from "../manifest.types";
import { CAPTURE_TOTAL_MS, captureMirror, serializeMirror } from "../mirror";
import { Outline, type PickTarget } from "../pick-highlight";
import type { Pin, SaveFlowInput, SaveFlowResult } from "../pin";
import {
	framedWidth,
	rowWidth,
	ScreenFrame,
	STEP_GUTTER,
	useScale,
	type Zoom,
} from "../screen-frame";
import { AUTO, CHIP, ScreenToolbar, type ThemeMode } from "../screen-toolbar";
import {
	GHOST_WIDTH,
	GhostCard,
	NewScreenCard,
	SpecCard,
	Stage,
	TailPlaceholder,
	type CardDraft,
	type CardStatus,
} from "./flow-cards";

/**
 * Flujos — a storyboard of the REAL routes, one live frame at a time.
 *
 * There is no fixture and no re-assembled screen here: a step is whatever that
 * route renders right now, for whoever is signed in to this browser. Change the
 * page and the flow changes with it — the one property a Storybook story can
 * never have.
 *
 * But "real" no longer means "live". Every step used to be a live iframe — up
 * to 12 of them, ×2 in split theme — and each one cost the dev server a
 * compile, an RSC render, a dev runtime and an HMR socket; opening the panel
 * put a host's `next dev` at ~7 GB. Now a sweep loads the steps one at a time,
 * captures each settled page into a static mirror (`mirror.ts`), and unmounts
 * the live frame. Activating a step brings the one interactive frame back;
 * activating another demotes it to a fresh mirror. A page that refuses to be
 * captured stays live — the bounded worst case is what every frame used to be.
 *
 * A journey can fork. The trunk is one row; each branch is a row of its own
 * starting after the trunk step it continues from. A step whose page is not
 * built yet is a **spec card** — what the screen must do — never a frame
 * pointed at a 404, and never a capture.
 *
 * And a journey is COMPOSED here, not in a form: click a control inside a
 * mirror (where clicks are otherwise dead) and the popover offers "+ Añadir
 * pantalla"; every row ends in a ghost card; every trunk step can start a
 * branch. The card that opens is a column on the board — the screen appears
 * where it will live. Each confirmation sends the whole journey through the
 * host's `saveFlow` action to `workbench flow set`, the same writer the
 * terminal uses, and the rescan hot-reloads the manifest: the card retires
 * the moment the real step arrives. Frames are keyed by `StepNode.key`, so an
 * added screen sweeps alone and every existing mirror stays put.
 *
 * Shares its toolbar with Componentes. **Auto** honours each step's own
 * viewport; picking a preset overrides every step, so you can walk the whole
 * flow at one breakpoint.
 */

function hora(timestamp: number): string {
	return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const EMPTY_DRAFT: CardDraft = { route: "", label: "", spec: "", via: "", branchLabel: "" };

/** The lane a board row addresses on the wire. */
function laneRefOf(lane: Lane): LaneRef {
	return lane.kind === "trunk"
		? { kind: "trunk" }
		: { kind: "branch", index: lane.index, id: lane.id };
}

/** The row half of a ref's key, matching `StepNode.key`'s prefix. */
function refKey(ref: LaneRef): string {
	return laneKey(ref.kind === "trunk" ? null : ref.id);
}

/** Everything the board needs to draw and drive the composer. Bundled so the
 *  presence of ONE prop says "this board can grow the journey". */
interface BoardComposer {
	/** The open card, already gated for the retire-on-arrival paint. */
	card: { at: ComposerTarget; draft: CardDraft; status: CardStatus } | null;
	cardViewport: Viewport | null;
	routesList: string;
	/** A write is in flight somewhere; every gesture waits its turn. */
	busy: boolean;
	onDraft: (changes: Partial<CardDraft>) => void;
	onSubmit: () => void;
	onCancelCard: () => void;
	onGhost: (lane: LaneRef, after: number, flat: number, anchorRoute: string) => void;
	onFork: (position: number, flat: number, anchorRoute: string) => void;
	onRemove: (lane: LaneRef) => void;
	/** Whether mirrors offer the connect gesture (off while Editar pins). */
	connect: boolean;
	onPick: (node: StepNode, pick: MirrorPick | null) => void;
	onHoverPick: (node: StepNode, pick: MirrorPick | null) => void;
}

function ThemedBoard({
	flow,
	lanes,
	scale,
	theme,
	nonce,
	editing,
	slot,
	frames,
	active,
	onCapture,
	onActivate,
	onRefresh,
	onDemote,
	registerLiveFrame,
	composer,
}: {
	flow: Flow;
	lanes: Lane[];
	scale: number;
	theme: "light" | "dark";
	nonce: number;
	editing: boolean;
	/** 0 is the sweep's board: captures happen here, never in the split twin. */
	slot: number;
	frames: Frames;
	active: { key: string; slot: number } | null;
	onCapture: (key: string, ticket: number, frame: HTMLIFrameElement) => void;
	onActivate: (key: string, slot: number) => void;
	onRefresh: (key: string) => void;
	onDemote: () => void;
	registerLiveFrame: (key: string, slot: number, frame: HTMLIFrameElement | null) => void;
	composer: BoardComposer | null;
}) {
	const { config } = useManifest();

	return (
		<div className="space-y-6">
			{lanes.map((lane) => {
				// Where a branch row starts: right after the column of the trunk
				// step it continues from, so the fork is drawn where it happens
				// rather than explained in a caption. The caption moves with the
				// row — pinned to the left edge, at 100% on a desktop trunk it sat
				// a whole screen away from the frames it named.
				const offset =
					lane.kind === "branch" && lane.fork !== null
						? rowWidth(forkPrefix(lanes, lane.fork), scale) + STEP_GUTTER
						: 0;
				const laneRef = laneRefOf(lane);
				const openCard =
					composer?.card &&
					!composer.card.at.fork &&
					refKey(composer.card.at.lane) === refKey(laneRef)
						? composer.card
						: null;
				const last = lane.nodes[lane.nodes.length - 1];
				return (
					// `w-max`: a block row would be the container's width minus the
					// offset, which at 100% zoom is 48px or negative — the caption
					// wrapped one word per line, then vanished. Sized to its row, the
					// caption has the row's width and the board scrolls as before.
					<div
						key={lane.kind === "trunk" ? "trunk" : `branch:${lane.id}`}
						className="w-max"
						style={offset > 0 ? { marginLeft: offset } : undefined}
					>
						{lane.kind === "branch" && (
							<p className="mb-2 whitespace-nowrap text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
								<span aria-hidden>↳ </span>
								{lane.label} · desde el paso {lane.from + 1}
								{lane.nodes[0]?.step.via && ` · vía «${lane.nodes[0].step.via}»`}
								{lane.fork === null && " — ese paso no está en el tronco"}
							</p>
						)}
						<ol
							className="flex items-start gap-4"
							aria-label={
								lane.kind === "trunk" ? "Tronco" : `${lane.label}, desde el paso ${lane.from + 1}`
							}
						>
							{lane.nodes.map((node, position) => {
								const { step, viewport } = node;
								const state = frameOf(frames, node);
								const isActive = active !== null && active.key === node.key && active.slot === slot;
								const capturingTicket = state.kind === "capturing" ? state.ticket : null;
								const capturingHere = capturingTicket !== null && slot === 0;
								// A restless step stays live in the sweep's board only — a
								// second live copy in the split twin would double exactly the
								// load the mirrors exist to avoid.
								const live = isActive || (state.kind === "restless" && slot === 0) || capturingHere;
								const isLast = position === lane.nodes.length - 1;
								// The via of the step this arrow LEADS TO.
								const nextVia = lane.nodes[position + 1]?.step.via;
								return (
									// Keys are scoped to the row, so the position alone is
									// unique; the route forces a remount exactly when the step
									// at that column changes.
									<Fragment key={`${position}:${step.route}`}>
										<li className="shrink-0">
											<ScreenFrame
												viewport={viewport}
												scale={scale}
												label={`${node.number}. ${step.label}`}
												editing={editing && state.kind !== "unbuilt"}
											>
												{state.kind === "unbuilt" ? (
													<SpecCard step={step} viewport={viewport} theme={theme} />
												) : live ? (
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
												) : state.kind === "mirrored" ? (
													<MirrorFrame
														srcdoc={state.srcdoc}
														title={`${flow.title} · ${step.label} (espejo)`}
														width={viewport.width}
														height={viewport.height}
														theme={theme}
														connect={
															composer?.connect && !editing
																? {
																		onPick: (pick) => composer.onPick(node, pick),
																		onHover: (pick) => composer.onHoverPick(node, pick),
																	}
																: undefined
														}
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
												)}
											</ScreenFrame>
											{(isActive ||
												state.kind === "mirrored" ||
												state.kind === "restless" ||
												state.kind === "unbuilt" ||
												capturingHere) && (
												<div
													className="mt-2 flex flex-wrap items-center gap-2"
													style={{ width: framedWidth(viewport.width, scale) }}
												>
													{state.kind === "unbuilt" ? (
														<span
															className="text-[11px] text-amber-700 dark:text-amber-300"
															title="La ruta no existe todavía; el cuadro muestra la especificación. Se vuelve un espejo real en el siguiente `workbench scan` después de que la página aterrice."
														>
															Sin página todavía
														</span>
													) : isActive ? (
														<>
															<span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
																En vivo
															</span>
															<button type="button" className={CHIP} onClick={onDemote}>
																Volver a espejo
															</button>
														</>
													) : state.kind === "mirrored" ? (
														<>
															<span
																className="text-[11px] text-zinc-500 dark:text-zinc-400"
																title="Espejo estático de la página real — sin peticiones al servidor."
															>
																Espejo · {hora(state.capturedAt)}
															</span>
															<button
																type="button"
																className={CHIP}
																onClick={() => onActivate(node.key, slot)}
																title="Monta la página real para interactuar con ella."
															>
																Activar
															</button>
															<button
																type="button"
																className={CHIP}
																onClick={() => onRefresh(node.key)}
																title="Vuelve a cargar la ruta y captura un espejo nuevo."
															>
																Actualizar
															</button>
														</>
													) : state.kind === "restless" ? (
														<>
															<span
																className="text-[11px] text-amber-700 dark:text-amber-300"
																title="La página no terminó de asentarse, así que el cuadro sigue en vivo."
															>
																En vivo — sin espejo
															</span>
															<button
																type="button"
																className={CHIP}
																onClick={() => onRefresh(node.key)}
															>
																Reintentar espejo
															</button>
														</>
													) : (
														<span className="text-[11px] text-zinc-500 dark:text-zinc-400">
															Cargando…
														</span>
													)}
													{composer && lane.kind === "trunk" && (
														<button
															type="button"
															className={CHIP}
															disabled={composer.busy || composer.card !== null}
															onClick={() => composer.onFork(position, node.flat, node.step.route)}
															title="Empieza una rama desde este paso."
														>
															+ rama
														</button>
													)}
													{composer &&
														isLast &&
														(lane.kind === "branch" || lane.nodes.length > 1) &&
														(lane.kind === "trunk" && isForkPoint(flow, position) ? (
															<button
																type="button"
																// Focusable and announced, unlike `disabled`:
																// the SENTENCE is the point, and a tooltip on
																// an unfocusable control reaches nobody.
																className={`${CHIP} opacity-40`}
																aria-disabled="true"
																onClick={() => {}}
																title="Este paso tiene ramas; quítalas primero."
															>
																quitar
															</button>
														) : (
															<button
																type="button"
																className={CHIP}
																disabled={composer.busy || composer.card !== null}
																onClick={() => composer.onRemove(laneRef)}
																title="Quita esta pantalla del recorrido."
															>
																quitar
															</button>
														))}
												</div>
											)}
											<div
												className="mt-2 flex items-start justify-between gap-2"
												style={{ width: framedWidth(viewport.width, scale) }}
											>
												{step.note && (
													<p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
														{step.note}
													</p>
												)}
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
										</li>
										{position < lane.nodes.length - 1 && (
											// Hidden only when it carries nothing: the vía caption is
											// the one authored fact this row adds, and burying it in
											// an aria-hidden arrow silenced it for assistive tech.
											<li
												aria-hidden={nextVia ? undefined : true}
												className="relative shrink-0 self-center text-xl text-zinc-400 dark:text-zinc-600"
											>
												<span aria-hidden>→</span>
												{nextVia && (
													// Absolutely positioned: STEP_GUTTER is what `fit`
													// counts for this column, and a caption with layout
													// width would make it lie.
													<span className="absolute left-1/2 top-full mt-0.5 -translate-x-1/2 whitespace-nowrap text-[10px] text-zinc-500 dark:text-zinc-400">
														«{nextVia}»
													</span>
												)}
											</li>
										)}
									</Fragment>
								);
							})}
							{composer && (
								<>
									<li
										aria-hidden
										className="shrink-0 self-center text-xl text-zinc-300 dark:text-zinc-700"
									>
										→
									</li>
									<li className="shrink-0">
										{openCard && composer.cardViewport ? (
											<ScreenFrame
												viewport={composer.cardViewport}
												scale={scale}
												label="Nueva pantalla"
											>
												{slot === 0 ? (
													<NewScreenCard
														viewport={composer.cardViewport}
														theme={theme}
														fork={false}
														routesList={composer.routesList}
														draft={openCard.draft}
														status={openCard.status}
														onDraft={composer.onDraft}
														onSubmit={composer.onSubmit}
														onCancel={composer.onCancelCard}
													/>
												) : (
													<TailPlaceholder
														viewport={composer.cardViewport}
														theme={theme}
														writing={openCard.status === "writing"}
													/>
												)}
											</ScreenFrame>
										) : (
											<GhostCard
												width={GHOST_WIDTH}
												height={last?.viewport.height ?? 844}
												scale={scale}
												label="+ Añadir pantalla"
												disabled={composer.busy || composer.card !== null}
												onOpen={() =>
													composer.onGhost(
														laneRef,
														lane.nodes.length - 1,
														last?.flat ?? 0,
														last?.step.route ?? "",
													)
												}
											/>
										)}
									</li>
								</>
							)}
						</ol>
					</div>
				);
			})}
			{composer?.card?.at.fork && composer.cardViewport && (
				// The branch being authored, drawn where it will live: its row
				// starts after the fork column, exactly like a real branch row.
				<div
					className="w-max"
					style={{
						marginLeft: rowWidth(forkPrefix(lanes, composer.card.at.flat), scale) + STEP_GUTTER,
					}}
				>
					<p className="mb-2 whitespace-nowrap text-[11px] font-medium text-sky-600 dark:text-sky-400">
						<span aria-hidden>↳ </span>
						{composer.card.draft.branchLabel.trim() || "nueva rama"} · desde el paso{" "}
						{composer.card.at.after + 1}
						{forkResolvesTo(flow, flow.steps[composer.card.at.after]?.route ?? "") !==
							composer.card.at.after &&
							" — el tronco repite esta ruta; el motor dibuja la rama desde su primera aparición"}
					</p>
					<ol className="flex items-start gap-4" aria-label="Nueva rama">
						<li className="shrink-0">
							<ScreenFrame viewport={composer.cardViewport} scale={scale} label="Nueva pantalla">
								{slot === 0 ? (
									<NewScreenCard
										viewport={composer.cardViewport}
										theme={theme}
										fork
										routesList={composer.routesList}
										draft={composer.card.draft}
										status={composer.card.status}
										onDraft={composer.onDraft}
										onSubmit={composer.onSubmit}
										onCancel={composer.onCancelCard}
									/>
								) : (
									<TailPlaceholder
										viewport={composer.cardViewport}
										theme={theme}
										writing={composer.card.status === "writing"}
									/>
								)}
							</ScreenFrame>
						</li>
					</ol>
				</div>
			)}
		</div>
	);
}

const ROUTES_LIST = "workbench-flow-routes";

export function FlowsPanel({
	flow,
	componentIndex,
	editing,
	onPin,
	onHover,
	onToggleEdit,
	pinCount,
	onOpenRequest,
	showChrome,
	initialViewport,
	initialZoom,
	initialTheme,
	routes,
	onSaveFlow,
}: {
	flow: Flow;
	componentIndex: ComponentIndex;
	editing: boolean;
	onPin: (pin: Pick<Pin, "element" | "node">) => void;
	onHover: (target: PickTarget | null) => void;
	onToggleEdit: () => void;
	pinCount: number;
	onOpenRequest: () => void;
	showChrome: boolean;
	initialViewport?: string;
	initialZoom?: Zoom;
	initialTheme?: ThemeMode;
	/** The app's page routes, offered as suggestions in the card. */
	routes?: string[];
	/** The host's Server Action. Absent, the board is read-only: no ghosts,
	 *  no chips, no connect gesture. */
	onSaveFlow?: (input: SaveFlowInput) => Promise<SaveFlowResult>;
}) {
	const { config, stats } = useManifest();
	const [nonce, setNonce] = useState(0);
	const [viewport, setViewport] = useState<string>(initialViewport ?? AUTO);
	const [zoom, setZoom] = useState<Zoom>(initialZoom ?? "fit");
	const [theme, setTheme] = useState<ThemeMode>(initialTheme ?? "light");
	const pickRef = useRef<HTMLDivElement>(null);

	const override = viewport === AUTO ? null : viewportById(config, viewport);
	// The config's default viewport: `bodyOf` elides it so a step that never
	// pinned one keeps following the default (see flow-edit's module doc).
	const defaultViewportId = viewportById(config, undefined).id;
	const { lanes, nodes } = useMemo(
		() => layOut(flow, (id) => override ?? viewportById(config, id)),
		[flow, override, config],
	);

	const [frames, setFrames] = useState<Frames>(NO_FRAMES);
	const [active, setActive] = useState<{ key: string; slot: number } | null>(null);
	const liveFrames = useRef(new Map<string, HTMLIFrameElement>());

	// "Recargar cuadros" starts the sweep over. A NEW flow remounts the panel
	// (keyed by flow.id at its call site), so this is only the button.
	useEffect(() => {
		setFrames(NO_FRAMES);
		setActive(null);
	}, [nonce]);

	// A rescan while the panel is open keeps the flow id (no remount) but can
	// add, remove or rebuild steps. The ledger is keyed by `StepNode.key`, so
	// nothing is reset: dead keys are pruned (their srcdocs freed), new keys
	// derive to queued and sweep alone — a composed screen never re-sweeps its
	// neighbours. `prune` keeps identity when nothing died.
	const shape = nodes.map((node) => node.key).join("|");
	useEffect(() => {
		setFrames((current) => prune(current, nodes));
		setActive((current) =>
			current && nodes.some((node) => node.key === current.key) ? current : null,
		);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [shape]);

	// The sweep: one capture in flight, ever — across the trunk AND every
	// branch, in flat order. The parallel version is the whole bug this panel
	// had — N simultaneous route loads is what filled the dev server's heap —
	// and strictly-sequential loads let every repeat route hit the compile
	// cache warm.
	const nextTicket = useRef(1);
	useEffect(() => {
		const next = nextCapture(frames, nodes);
		if (next === null) return;
		setFrames((current) => {
			// Re-checked inside the updater: a StrictMode double-invoke or a
			// concurrent transition must not start two captures.
			if (nextCapture(current, nodes) !== next) return current;
			const ticket = nextTicket.current;
			nextTicket.current += 1;
			return withFrame(current, next, { kind: "capturing", ticket });
		});
	}, [frames, nodes]);

	// Watchdog: a frame whose route never even loads must not hold the rest of
	// the storyboard hostage. The step is marked restless — its frame stays
	// mounted and may still finish — and the sweep moves on. Keyed by the
	// capture's own ticket, NOT the ledger: depending on the whole ledger
	// restarted the 30 s timer every time the user touched any other step, so
	// a stuck capture was never timed out.
	let captureKey: string | null = null;
	let captureTicket: number | null = null;
	for (const node of nodes) {
		const frame = frameOf(frames, node);
		if (frame.kind === "capturing") {
			captureKey = node.key;
			captureTicket = frame.ticket;
			break;
		}
	}
	useEffect(() => {
		if (captureKey === null || captureTicket === null) return;
		const key = captureKey;
		const ticket = captureTicket;
		const timer = setTimeout(() => {
			setFrames((current) => {
				const entry = current.get(key);
				return entry?.kind === "capturing" && entry.ticket === ticket
					? withFrame(current, key, { kind: "restless" })
					: current;
			});
		}, CAPTURE_TOTAL_MS);
		return () => clearTimeout(timer);
	}, [captureKey, captureTicket]);

	const onCapture = useCallback(
		(key: string, ticket: number, frame: HTMLIFrameElement) => {
			const route = nodes.find((node) => node.key === key)?.step.route;
			if (!route) return;
			void captureMirror(frame, route)
				.then((srcdoc) => {
					setFrames((current) => {
						// Only THIS capture takes the result: a stale resolution
						// after Recargar or a StrictMode remount must not overwrite
						// a newer state.
						const entry = current.get(key);
						if (entry?.kind !== "capturing" || entry.ticket !== ticket) return current;
						return withFrame(
							current,
							key,
							srcdoc ? { kind: "mirrored", srcdoc, capturedAt: Date.now() } : { kind: "restless" },
						);
					});
				})
				// captureMirror is defensively wrapped, but a throw inside the
				// state updater above would otherwise surface as an unhandled
				// rejection no boundary sees.
				.catch(() => {});
		},
		[nodes],
	);

	// Demotion re-captures synchronously from the live document before the
	// frame unmounts, so the mirror left behind is as fresh as what the user
	// just saw — not the pre-activation snapshot.
	const onDemote = useCallback(() => {
		if (!active) return;
		const element = liveFrames.current.get(`${active.slot}:${active.key}`);
		const route = nodes.find((node) => node.key === active.key)?.step.route;
		if (element && route) {
			try {
				const doc = element.contentDocument;
				if (doc) {
					// The route the frame is on NOW: an activated frame can be
					// navigated, and the original route as <base> made every
					// relative asset in the demoted mirror 404.
					const liveRoute = element.contentWindow?.location.pathname ?? route;
					const srcdoc = serializeMirror(doc, liveRoute, window.location.origin);
					const capturedAt = Date.now();
					const key = active.key;
					setFrames((current) => withFrame(current, key, { kind: "mirrored", srcdoc, capturedAt }));
				}
			} catch {
				// The step keeps its previous mirror rather than going blank.
			}
		}
		setActive(null);
	}, [active, nodes]);

	const onActivate = useCallback(
		(key: string, slot: number) => {
			onDemote();
			setActive({ key, slot });
		},
		[onDemote],
	);

	const onRefresh = useCallback((key: string) => {
		setFrames((current) => withFrame(current, key, { kind: "queued" }));
	}, []);

	const registerLiveFrame = useCallback(
		(key: string, slot: number, frame: HTMLIFrameElement | null) => {
			const mapKey = `${slot}:${key}`;
			if (frame) liveFrames.current.set(mapKey, frame);
			else liveFrames.current.delete(mapKey);
		},
		[],
	);

	/* ---------------------------------------------------------- composer */

	const canCompose = Boolean(onSaveFlow);
	const [composer, setComposer] = useState<{
		at: ComposerTarget;
		draft: CardDraft;
		status: CardStatus;
	} | null>(null);
	const [removing, setRemoving] = useState<{ error: string | null } | null>(null);
	const [connect, setConnect] = useState<{
		node: StepNode;
		pick: MirrorPick;
		route: string | null;
		mode: PopoverMode;
	} | null>(null);
	const [connectHover, setConnectHover] = useState<{
		pick: MirrorPick;
		route: string | null;
	} | null>(null);

	// The card retires the moment the hot-reloaded flow holds its step — the
	// render-time gate keeps the card and the real step from ever painting
	// together, the effect then clears the state.
	const landed =
		composer !== null &&
		typeof composer.status === "object" &&
		"written" in composer.status &&
		composer.status.written === null &&
		hasStepAt(flow, composer.at, composer.draft.route.trim());
	useEffect(() => {
		if (landed) setComposer(null);
	}, [landed]);
	const card = composer && !landed ? composer : null;

	const cardViewport = card
		? (override ??
			nodes.find((node) => node.flat === card.at.flat)?.viewport ??
			viewportById(config, undefined))
		: null;
	const busy = card?.status === "writing" || (removing !== null && removing.error === null);

	// Editar wins: arming both gestures would pin AND offer on one click.
	useEffect(() => {
		if (editing) {
			setConnect(null);
			setConnectHover(null);
		}
	}, [editing]);
	// The mirror a popover was anchored to is gone after a reshape or reload —
	// and a successful removal stays "busy" until this lands, because a
	// gesture in the gap would re-send the stale body and resurrect the step.
	useEffect(() => {
		setConnect(null);
		setConnectHover(null);
		setRemoving((current) => (current && current.error === null ? null : current));
	}, [shape, nonce]);

	const locate = (key: string) => {
		for (const lane of lanes) {
			const position = lane.nodes.findIndex((node) => node.key === key);
			if (position === -1) continue;
			return {
				ref: laneRefOf(lane),
				kind: lane.kind,
				position,
				isLast: position === lane.nodes.length - 1,
			};
		}
		return null;
	};

	const submit = async () => {
		if (!composer || !onSaveFlow || composer.status === "writing") return;
		const { at, draft } = composer;
		// The journey can be rescanned under an open card (the terminal, a
		// watcher). The anchor is revalidated by route, never trusted by
		// index — a silent misplace is worse than asking again.
		const anchorStep =
			at.lane.kind === "trunk"
				? flow.steps[at.after]
				: flow.branches[at.lane.index]?.id === at.lane.id
					? flow.branches[at.lane.index]?.steps[at.after]
					: undefined;
		if (!anchorStep || anchorStep.route !== at.anchorRoute) {
			setComposer(
				(current) =>
					current && {
						...current,
						status: {
							error:
								"El recorrido cambió debajo de la tarjeta; ciérrala y vuelve a añadir la pantalla.",
						},
					},
			);
			return;
		}
		const stepViewport = anchorStep.viewport;
		const step = stepInputOf(draft, stepViewport === defaultViewportId ? "" : stepViewport);
		const body = at.fork
			? forkFrom(bodyOf(flow, defaultViewportId), anchorStep.route, draft.branchLabel.trim(), step)
			: appendStep(bodyOf(flow, defaultViewportId), at.lane, step);
		setComposer((current) => current && { ...current, status: "writing" });
		try {
			// `id` is always this flow's: on a spider flow that ADOPTS it — the
			// engine writes the declared flow under the discovered id, and the
			// rail entry stops saying «descubierto» on the next map.
			const saved = await onSaveFlow({ ...body, id: flow.id });
			setComposer(
				(current) =>
					current && {
						...current,
						status: saved.ok
							? { written: saved.note ?? null }
							: { error: saved.error ?? "Falló la escritura." },
					},
			);
		} catch (error) {
			// The production noop THROWS by design, and any Server Action can
			// reject on a network blip; the typed screen must survive it.
			setComposer(
				(current) =>
					current && {
						...current,
						status: { error: error instanceof Error ? error.message : "Falló la escritura." },
					},
			);
		}
	};

	const composerProps: BoardComposer | null = canCompose
		? {
				card,
				cardViewport,
				routesList: ROUTES_LIST,
				busy,
				onDraft: (changes) =>
					setComposer(
						(current) =>
							current && { ...current, status: "editing", draft: { ...current.draft, ...changes } },
					),
				onSubmit: () => void submit(),
				onCancelCard: () => setComposer(null),
				onGhost: (lane, after, flat, anchorRoute) => {
					setConnect(null);
					setComposer({
						at: { lane, after, anchorRoute, fork: false, flat },
						draft: EMPTY_DRAFT,
						status: "editing",
					});
				},
				onFork: (position, flat, anchorRoute) => {
					setConnect(null);
					setComposer({
						at: { lane: { kind: "trunk" }, after: position, anchorRoute, fork: true, flat },
						draft: EMPTY_DRAFT,
						status: "editing",
					});
				},
				onRemove: (lane) => {
					if (!onSaveFlow) return;
					// Re-derived by id at click time: a rescan can reorder
					// branches, and a stale index removes from the wrong lane.
					const target: LaneRef | null =
						lane.kind === "trunk"
							? lane
							: (() => {
									const index = flow.branches.findIndex((branch) => branch.id === lane.id);
									return index === -1 ? null : ({ kind: "branch", index, id: lane.id } as const);
								})();
					if (!target) {
						setRemoving({ error: "El recorrido cambió; esa fila ya no existe." });
						return;
					}
					setRemoving({ error: null });
					void onSaveFlow({ ...removeLast(bodyOf(flow, defaultViewportId), target), id: flow.id })
						.then((saved) => {
							if (!saved.ok) setRemoving({ error: saved.error ?? "Falló la escritura." });
							else if (saved.note) setRemoving({ error: saved.note });
							// On a clean success the shape effect clears it when the
							// hot-reloaded map lands.
						})
						.catch((error: unknown) =>
							setRemoving({
								error: error instanceof Error ? error.message : "Falló la escritura.",
							}),
						);
				},
				connect: !editing,
				onPick: (node, pick) => {
					if (!pick) {
						setConnect(null);
						return;
					}
					const loc = locate(node.key);
					if (!loc) return;
					const route = routeOfHref(pick.href, window.location.origin);
					const mode: PopoverMode = loc.isLast
						? "append"
						: loc.kind === "trunk"
							? "fork"
							: "blocked";
					setConnect({ node, pick, route, mode });
					setConnectHover(null);
				},
				onHoverPick: (_node, pick) => {
					setConnectHover(
						pick ? { pick, route: routeOfHref(pick.href, window.location.origin) } : null,
					);
				},
			}
		: null;

	const confirmConnect = () => {
		if (!connect) return;
		const { node, pick, route, mode } = connect;
		const loc = locate(node.key);
		setConnect(null);
		if (!loc || mode === "blocked") return;
		const draft: CardDraft = {
			route: route ?? "",
			label: pick.text,
			spec: "",
			via: pick.text,
			branchLabel: pick.text,
		};
		const at: ComposerTarget =
			mode === "fork"
				? {
						lane: { kind: "trunk" },
						after: loc.position,
						anchorRoute: node.step.route,
						fork: true,
						flat: node.flat,
					}
				: {
						lane: loc.ref,
						after: loc.position,
						anchorRoute: node.step.route,
						fork: false,
						flat: node.flat,
					};
		setComposer({ at, draft, status: "editing" });
	};

	/* ------------------------------------------------------------ layout */

	// `fit` fits EVERY row (`fitRows` says why "the widest" is not enough),
	// composer tails included: the ghost and the open card are real columns,
	// and a `fit` that ignored them put a scrollbar on a board whose promise
	// is that it fits.
	const tails = useMemo((): RowTails | undefined => {
		if (!canCompose) return undefined;
		const tail = new Map<string, number>();
		for (const lane of lanes) {
			const key = lane.kind === "trunk" ? laneKey(null) : laneKey(lane.id);
			const width =
				card && !card.at.fork && refKey(card.at.lane) === key
					? (cardViewport?.width ?? GHOST_WIDTH)
					: GHOST_WIDTH;
			tail.set(key, width);
		}
		return {
			tail,
			forkRow:
				card?.at.fork && cardViewport ? { fork: card.at.flat, width: cardViewport.width } : null,
		};
	}, [canCompose, lanes, card, cardViewport]);
	const rows = useMemo(() => rowExtents(lanes, tails), [lanes, tails]);
	const { ref: measureRef, scale } = useScale(zoom, rows);

	const themes: Array<"light" | "dark"> = theme === "split" ? ["light", "dark"] : [theme];

	useInspect(
		editing,
		useCallback(() => pickRef.current, []),
		componentIndex,
		{ onPin, onHover },
		// Frames appear as the sweep advances and on activation, and iframes are
		// instrumented only at attach time — the transitions have to be in here.
		`${flow.id}:${nonce}:${viewport}:${zoom}:${theme}:${nodes
			.map((node) => frameOf(frames, node).kind.charAt(0))
			.join("")}:${active ? `${active.slot}.${active.key}` : "-"}`,
	);

	const unbuilt = nodes.filter((node) => !node.step.exists).length;

	return (
		<div className="flex h-full flex-col">
			{showChrome && (
				<ScreenToolbar
					viewport={viewport}
					onViewport={setViewport}
					zoom={zoom}
					onZoom={setZoom}
					theme={theme}
					onTheme={setTheme}
					actions={
						<button type="button" onClick={() => setNonce((value) => value + 1)} className={CHIP}>
							Recargar cuadros
						</button>
					}
					hint={
						viewport === AUTO
							? "Rutas reales, cargadas de una en una y congeladas como espejos; activa un paso para interactuar. Las pantallas con sesión requieren haber iniciado sesión aquí."
							: `Rutas reales, los ${nodes.length - unbuilt} pasos a ${override?.width}px, congeladas como espejos${unbuilt > 0 ? `; ${unbuilt} por construir` : ""}.`
					}
					editing={editing}
					onToggleEdit={onToggleEdit}
					pinCount={pinCount}
					onOpenRequest={onOpenRequest}
					isolatedBase={{ tab: "flujos", flow: flow.id }}
				/>
			)}

			<div
				ref={measureRef}
				className="min-h-0 flex-1 overflow-auto bg-zinc-50 p-6 dark:bg-zinc-950"
			>
				<header className="mb-5 max-w-2xl">
					<div className="flex items-center gap-2">
						<h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{flow.title}</h2>
						{flow.origin === "spider" && (
							<span
								className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
								title="Descubierto siguiendo los enlaces reales de la app. Añádele una pantalla y queda declarado en workbench.config.json con este mismo id."
							>
								descubierto
							</span>
						)}
						{flow.branches.length > 0 && (
							<span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
								{flow.branches.length} {flow.branches.length === 1 ? "rama" : "ramas"}
							</span>
						)}
					</div>
					{flow.description && (
						<p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{flow.description}</p>
					)}
					{canCompose && (
						<p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
							Haz clic en un botón o enlace de un espejo para añadir la pantalla a la que lleva;
							cada fila termina en «+ Añadir pantalla».
						</p>
					)}
					{removing?.error && (
						<p role="alert" className="mt-1 text-[11px] text-red-700 dark:text-red-300">
							{removing.error}
						</p>
					)}
					{unbuilt > 0 && (
						// The card says it per step; the header says it once, so a
						// storyboard that is mostly specification is not mistaken for
						// a storyboard that is mostly broken.
						<p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
							{unbuilt} {unbuilt === 1 ? "paso por construir" : "pasos por construir"} — se muestran
							sus especificaciones; se vuelven espejos reales cuando sus páginas aterricen.
						</p>
					)}
					{stats.untraceableHrefs > 0 && (
						// Said out loud rather than implied: the storyboard is built
						// from links the scanner could resolve, and this is how many
						// it could not.
						<p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
							{stats.untraceableHrefs} enlaces con destino calculado no se pudieron rastrear, así
							que puede faltar algún paso.
						</p>
					)}
					{stats.droppedFlows > 0 && (
						// Same rule: the rail shows a capped list, and a silent cap
						// reads as "that is all of them".
						<p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
							{stats.droppedFlows} recorridos adicionales encontrados y no mostrados; declara los
							que importen en workbench.config.json.
						</p>
					)}
				</header>

				{canCompose && (
					<datalist id={ROUTES_LIST}>
						{(routes ?? []).map((route) => (
							<option key={route} value={route} />
						))}
					</datalist>
				)}

				<div ref={pickRef} tabIndex={-1}>
					<div className="space-y-8">
						{themes.map((mode, slot) => (
							// Keyed by slot, not by mode: with a `mode` key, toggling
							// light↔dark remounted the whole board — every frame
							// refetched for a class flip. By slot, the first board
							// re-renders in place and only split mounts a second one.
							<div key={slot === 0 ? "a" : "b"}>
								{themes.length > 1 && (
									<p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
										{mode === "light" ? "Claro" : "Oscuro"}
									</p>
								)}
								<ThemedBoard
									flow={flow}
									lanes={lanes}
									scale={scale}
									theme={mode}
									nonce={nonce}
									editing={editing}
									slot={slot}
									frames={frames}
									active={active}
									onCapture={onCapture}
									onActivate={onActivate}
									onRefresh={onRefresh}
									onDemote={onDemote}
									registerLiveFrame={registerLiveFrame}
									composer={composerProps}
								/>
							</div>
						))}
					</div>
				</div>
			</div>

			{connectHover && !connect && !editing && (
				<Outline
					rect={connectHover.pick.rect}
					tone="sky"
					label={`«${connectHover.pick.text || "control"}»${connectHover.route ? ` → ${connectHover.route}` : ""}`}
				/>
			)}
			{connect && (
				<ConnectPopover
					pick={connect.pick}
					route={connect.route}
					mode={connect.mode}
					onConfirm={confirmConnect}
					onCancel={() => {
						setConnect(null);
						pickRef.current?.focus();
					}}
				/>
			)}
		</div>
	);
}
