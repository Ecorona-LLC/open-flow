"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useManifest } from "../config-context";
import { ConnectPopover } from "../connect-popover";
import { useInspect } from "../edit-mode";
import {
	actionFor,
	connectGestures,
	appendStep,
	atCap,
	bodyOf,
	connectIntent,
	forkFrom,
	hasStepAt,
	laneRefOf,
	removeLast,
	routeOfHref,
	stepInputOf,
	type ComposerTarget,
	type ConnectAction,
	type ConnectIntent,
	type LaneRef,
} from "../flow-edit";
import { frameOf, NO_FRAMES, nextCapture, prune, withFrame, type Frames } from "../flow-frames";
import { EN_CURSO } from "../journey-acts";
import { layOut, locateNode, type StepNode } from "../flow-layout";
import type { MirrorPick } from "../frame";
import type { ComponentIndex } from "../hover-inspect";
import { viewportById } from "../manifest";
import type { Flow } from "../manifest.types";
import { CAPTURE_TOTAL_MS, captureMirror, serializeMirror } from "../mirror";
import { Outline, type PickTarget } from "../pick-highlight";
import { readSketch, type Sketch } from "../screen-sketch";
import type { Pin, SaveFlowInput, SaveFlowResult } from "../pin";
import type { CanvasDetail } from "../canvas-gestures";
import { AUTO, CHIP, ScreenToolbar, type ThemeMode } from "../screen-toolbar";
import { type CardDraft, type CardStatus } from "./flow-cards";
import { CanvasBoard, type BoardComposer } from "./flow-canvas-board";

/**
 * Flujos — the REAL routes as a graph on a pan/zoom canvas, one live frame at
 * a time.
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
 * A journey can fork. `flow-graph` turns the walk into nodes and edges,
 * `CanvasBoard` places them, and branches fan out below their fork step with
 * the «vía» captions riding the edges. A step whose page is not built yet is a
 * **spec card** — what the screen must do — never a frame pointed at a 404,
 * and never a capture.
 *
 * And a journey is COMPOSED here, not in a form: click a control inside a
 * mirror (where clicks are otherwise dead) and the popover offers "+ Añadir
 * pantalla"; every row ends in a ghost card; every trunk step can start a
 * branch. The card that opens is a node on the canvas — the screen appears
 * where it will live. Each confirmation sends the whole journey through the
 * host's `saveFlow` action to `workbench flow set`, the same writer the
 * terminal uses, and the rescan hot-reloads the manifest: the card retires
 * the moment the real step arrives. Frames are keyed by `StepNode.key`, so an
 * added screen sweeps alone and every existing mirror stays put.
 *
 * Shares its toolbar with Componentes. **Auto** honours each step's own
 * viewport; picking a preset overrides every step, so you can walk the whole
 * flow at one breakpoint. The toolbar's zoom presets do not apply — the
 * canvas has its own zoom, bottom-left.
 */

const EMPTY_DRAFT: CardDraft = { route: "", label: "", spec: "", via: "", branchLabel: "" };

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
	const [theme, setTheme] = useState<ThemeMode>(initialTheme ?? "light");
	// The canvas' distance band. Panel state because `useInspect` keys off it:
	// crossing the threshold remounts every mirror, and listeners attached to
	// the old iframes are attached to nothing.
	const [detail, setDetail] = useState<CanvasDetail>("near");
	const pickRef = useRef<HTMLDivElement>(null);
	const noticesRef = useRef<HTMLDetailsElement>(null);

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
				.then((capture) => {
					setFrames((current) => {
						// Only THIS capture takes the result: a stale resolution
						// after Recargar or a StrictMode remount must not overwrite
						// a newer state.
						const entry = current.get(key);
						if (entry?.kind !== "capturing" || entry.ticket !== ticket) return current;
						return withFrame(
							current,
							key,
							capture
								? {
										kind: "mirrored",
										srcdoc: capture.srcdoc,
										sketch: capture.sketch,
										capturedAt: Date.now(),
									}
								: { kind: "restless" },
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
					// Its own guard, like `captureMirror`'s: a sketch is an
					// enhancement, the mirror is the contract. Sharing one try meant
					// a rect that threw discarded an already-serialized mirror and
					// silently lost everything the user just did in the live frame.
					let sketch: Sketch | null = null;
					try {
						sketch = readSketch(doc, {
							width: element.contentWindow?.innerWidth ?? element.clientWidth,
							height: element.contentWindow?.innerHeight ?? element.clientHeight,
						});
					} catch {
						// The card falls back to «Sin vista previa»; the mirror stands.
					}
					const capturedAt = Date.now();
					const key = active.key;
					setFrames((current) =>
						withFrame(current, key, { kind: "mirrored", srcdoc, sketch, capturedAt }),
					);
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
		intent: ConnectIntent;
	} | null>(null);
	const [connectHover, setConnectHover] = useState<{
		pick: MirrorPick;
		route: string | null;
		intent: ConnectIntent;
		/** A click would be dropped right now. A fact the tag must carry. */
		parked: boolean;
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

	// Panning fires no scroll event, so the popover's scroll-close never hears
	// it. The picks' rects are frozen at click time — under a moved viewport
	// they point at nothing, so CLOSING (not recomputing) is the design.
	// Functional no-op-when-null updates: a 60 Hz pan with nothing open must
	// schedule no re-renders.
	const onCanvasViewport = useCallback(() => {
		setConnect((current) => (current === null ? current : null));
		setConnectHover((current) => (current === null ? current : null));
		// The notices float over the canvas; a pan under them leaves them
		// pointing at nothing, the same reason the pick overlays close.
		if (noticesRef.current?.open) noticesRef.current.open = false;
	}, []);

	/** What a control on this screen can do — one answer, four callers. */
	const intentFor = (node: StepNode, pick: MirrorPick) => {
		const loc = locate(node.key);
		if (!loc) return null;
		const route = routeOfHref(pick.href, window.location.origin);
		return {
			loc,
			route,
			intent: connectIntent(
				flow,
				{ lane: loc.kind, position: loc.position, isLast: loc.isLast },
				route,
				atCap(flow, config.maxFlowSteps),
			),
		};
	};

	const locate = (key: string) => {
		const found = locateNode(lanes, key);
		return found && { ref: laneRefOf(found.lane), kind: found.lane.kind, ...found };
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
					// The same guard every chip carries. Without it a click while a
					// card is open silently replaced that card's draft — the route
					// and the spec somebody had already typed.
					if (busy || card !== null) return;
					const resolved = intentFor(node, pick);
					if (!resolved) return;
					// A right-click asked for a branch by name. When that is legal
					// here, skip the popover entirely — the whole point of the
					// gesture is that «Iniciar sesión» and «Crear cuenta» become
					// two branches without a menu in between. When it is not, the
					// popover opens and says why.
					const wanted = actionFor(resolved.intent, pick.wants);
					if (pick.wants === "fork" && wanted?.kind === "fork") {
						setConnectHover(null);
						openCard(node, resolved.loc, pick, resolved.route, wanted);
						return;
					}
					setConnect({ node, pick, route: resolved.route, intent: resolved.intent });
					setConnectHover(null);
				},
				onHoverPick: (node, pick) => {
					// Hover reads the SAME rule the click will apply, so the label
					// can promise exactly what happens — including that right now
					// it happens to do nothing. `onPick` drops a pick while a card
					// is open or a write is in flight, and a tag reading «clic
					// seguir» over a click that is silently swallowed is the very
					// failure the right button was already taught to avoid.
					const resolved = pick ? intentFor(node, pick) : null;
					setConnectHover(
						pick && resolved
							? {
									pick,
									route: resolved.route,
									intent: resolved.intent,
									parked: busy || card !== null,
								}
							: null,
					);
				},
			}
		: null;

	/** Open the composer for a picked control. One writer, three callers: the
	 *  popover's primary, its «¿rama?» switch, and the right-click shortcut. */
	const openCard = (
		node: StepNode,
		loc: NonNullable<ReturnType<typeof locate>>,
		pick: MirrorPick,
		route: string | null,
		action: ConnectAction,
	) => {
		const draft: CardDraft = {
			route: route ?? "",
			label: pick.text,
			spec: "",
			via: pick.text,
			// The engine slugs a branch label into its id and refuses twins, so
			// «Ver más» in the header and «Ver más» in the footer would collide —
			// after the spec had been typed. Seeded blank instead of with a name
			// that is already taken, so the card asks rather than the engine
			// refuses.
			branchLabel: flow.branches.some((branch) => branch.label === pick.text) ? "" : pick.text,
		};
		const at: ComposerTarget =
			action.kind === "fork"
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

	const confirmConnect = (action: ConnectAction) => {
		if (!connect) return;
		const { node, pick, route } = connect;
		const loc = locate(node.key);
		setConnect(null);
		if (loc) openCard(node, loc, pick, route, action);
	};

	/* ------------------------------------------------------------ render */

	const themes: Array<"light" | "dark"> = theme === "split" ? ["light", "dark"] : [theme];

	useInspect(
		editing,
		useCallback(() => pickRef.current, []),
		componentIndex,
		{ onPin, onHover },
		// Frames appear as the sweep advances and on activation, and iframes are
		// instrumented only at attach time — every transition has to be in here.
		// A pan or a zoom is NOT one: the canvas moves frames, it never remounts
		// them. Crossing the DETAIL threshold is, though — far replaces every
		// mirror with a card and near builds fresh iframes, so without `detail`
		// «Señalar» went silently dead after one zoom out and back.
		`${flow.id}:${nonce}:${viewport}:${theme}:${detail}:${nodes
			.map((node) => frameOf(frames, node).kind.charAt(0))
			.join("")}:${active ? `${active.slot}.${active.key}` : "-"}`,
	);

	const unbuilt = nodes.filter((node) => !node.step.exists).length;
	// Everything the panel must say but need not shout: the header shows the
	// first and counts the rest, and the whole set opens on click.
	const notices = [
		unbuilt > 0 &&
			`${unbuilt} ${unbuilt === 1 ? "paso por construir" : "pasos por construir"} — se muestran sus especificaciones; se vuelven espejos reales cuando sus páginas aterricen.`,
		stats.untraceableHrefs > 0 &&
			`${stats.untraceableHrefs} enlaces con destino calculado no se pudieron rastrear, así que puede faltar algún paso.`,
		stats.droppedFlows > 0 &&
			`${stats.droppedFlows} recorridos adicionales encontrados y no mostrados; declara los que importen en workbench.config.json.`,
		// The trim is said per step too, but that footer is `NearOnly` — and a
		// truncated journey matters most at the far zoom, where you are reading
		// the shape and cannot see the sentence.
		flow.steps.some((step) => step.notice) &&
			"Este recorrido se muestra recortado; abre un paso para ver por qué.",
	].filter((notice): notice is string => typeof notice === "string");

	return (
		<div className="flex h-full flex-col">
			{showChrome && (
				<ScreenToolbar
					viewport={viewport}
					onViewport={setViewport}
					zoomDisabledReason="El lienzo tiene su propio zoom, abajo a la izquierda."
					theme={theme}
					onTheme={setTheme}
					actions={
						<button type="button" onClick={() => setNonce((value) => value + 1)} className={CHIP}>
							Recargar cuadros
						</button>
					}
					hint={
						viewport === AUTO
							? "Rutas reales, cargadas de una en una y congeladas como espejos; activa un paso para interactuar. Arrastra el fondo para moverte; Ctrl/⌘ + rueda para acercar; con el lienzo enfocado, flechas para moverte, + y − para el zoom, 0 para ajustar."
							: `Rutas reales, los ${nodes.length - unbuilt} pasos a ${override?.width}px, congeladas como espejos${unbuilt > 0 ? `; ${unbuilt} por construir` : ""}. Arrastra el fondo para moverte; Ctrl/⌘ + rueda para acercar; con el lienzo enfocado, flechas para moverte, + y − para el zoom, 0 para ajustar.`
					}
					editing={editing}
					onToggleEdit={onToggleEdit}
					pinCount={pinCount}
					onOpenRequest={onOpenRequest}
					isolatedBase={{ tab: "flujos", flow: flow.id }}
				/>
			)}

			<div className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-6 py-2 dark:border-zinc-800 dark:bg-zinc-950">
				<h2 className="shrink-0 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
					{flow.title}
				</h2>
				{flow.origin === "spider" && (
					<span
						className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
						title="Descubierto siguiendo los enlaces reales de la app. Añádele una pantalla y queda declarado en workbench.config.json con este mismo id."
					>
						descubierto
					</span>
				)}
				{flow.branches.length > 0 && (
					<span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
						{flow.branches.length} {flow.branches.length === 1 ? "rama" : "ramas"}
					</span>
				)}
				{/* One line, not six. The canvas is the panel's whole point and the
				    header used to spend a fifth of its height on prose that is the
				    same on every visit; what is left is a summary you can open. */}
				<details ref={noticesRef} className="group relative min-w-0 flex-1">
					<summary className="cursor-pointer list-none truncate text-[11px] text-zinc-500 marker:content-none [&::-webkit-details-marker]:hidden dark:text-zinc-400">
						<span className="underline decoration-dotted underline-offset-2">
							{notices.length > 0 ? notices[0] : (flow.description ?? "Sobre este recorrido")}
						</span>
						{notices.length > 1 && (
							<span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
								+{notices.length - 1}
								<span className="sr-only"> avisos más</span>
							</span>
						)}
					</summary>
					<div className="absolute z-20 mt-1 max-w-2xl rounded-md border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
						{flow.description && (
							<p className="text-sm text-zinc-600 dark:text-zinc-400">{flow.description}</p>
						)}
						{notices.map((notice) => (
							<p key={notice} className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
								{notice}
							</p>
						))}
						{canCompose && (
							<p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
								Haz clic en un botón o enlace de un espejo para añadir la pantalla a la que lleva;
								cada fila termina en «+ Añadir pantalla».
							</p>
						)}
					</div>
				</details>
				{notices.length > 0 && (
					// Said out loud regardless of the disclosure: "whenever the
					// scan can't see something, it says so".
					<ul className="sr-only">
						{notices.map((notice) => (
							<li key={notice}>{notice}</li>
						))}
					</ul>
				)}
				{removing?.error && (
					<p
						role="alert"
						className="min-w-0 flex-1 truncate text-[11px] text-red-700 dark:text-red-300"
						title={removing.error}
					>
						{removing.error}
					</p>
				)}

				{canCompose && (
					<datalist id={ROUTES_LIST}>
						{(routes ?? []).map((route) => (
							<option key={route} value={route} />
						))}
					</datalist>
				)}
			</div>

			<div ref={pickRef} tabIndex={-1} className="min-h-0 flex-1">
				<CanvasBoard
					flow={flow}
					lanes={lanes}
					themes={themes}
					nonce={nonce}
					editing={editing}
					frames={frames}
					active={active}
					// Only the SLOT COUNT changes the geometry: a light↔dark flip
					// lays out identically, and refitting on it threw away the
					// user's pan for a palette change.
					fitKey={`${viewport}:${themes.length}`}
					shape={shape}
					onCapture={onCapture}
					onActivate={onActivate}
					onRefresh={onRefresh}
					onDemote={onDemote}
					registerLiveFrame={registerLiveFrame}
					composer={composerProps}
					onViewportChange={onCanvasViewport}
					onDetailChange={setDetail}
				/>
			</div>

			{connectHover && !connect && !editing && (
				<Outline
					rect={connectHover.pick.rect}
					tone="sky"
					label={`«${connectHover.pick.text || "control"}»${
						connectHover.route ? ` → ${connectHover.route}` : ""
					}`}
					hint={connectHover.parked ? EN_CURSO : connectGestures(connectHover.intent)}
				/>
			)}
			{connect && (
				<ConnectPopover
					pick={connect.pick}
					route={connect.route}
					intent={connect.intent}
					onConfirm={confirmConnect}
					// `useFloating` returns focus to the canvas host on close, for
					// every one of the six ways this can be dismissed — this used
					// to be hand-rolled here and covered only the cancel button.
					//
					// Functional and identity-checked, because one of those six is
					// a window blur, and the gesture that opens the NEXT popover
					// causes exactly such a blur by moving focus into a mirror.
					// Whether it lands before or after the click that re-anchors
					// is browser-dependent; if it lands after, an unconditional
					// clear here would discard the popover the click had just
					// opened. A box may close itself, never its successor.
					onCancel={() => setConnect((open) => (open === connect ? null : open))}
				/>
			)}
		</div>
	);
}
