"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useManifest } from "../config-context";
import { useInspect } from "../edit-mode";
import { MirrorFrame, RouteFrame } from "../frame";
import type { ComponentIndex } from "../hover-inspect";
import { frameUrl, viewportById } from "../manifest";
import type { Flow, Viewport } from "../manifest.types";
import { CAPTURE_TOTAL_MS, captureMirror, serializeMirror } from "../mirror";
import type { PickTarget } from "../pick-highlight";
import type { Pin } from "../pin";
import { FRAME_CHROME, ScreenFrame, STEP_GUTTER, useScale, type Zoom } from "../screen-frame";
import { AUTO, CHIP, ScreenToolbar, type ThemeMode } from "../screen-toolbar";

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
 * Shares its toolbar with Componentes. **Auto** honours each step's own
 * viewport; picking a preset overrides every step, so you can walk the whole
 * flow at one breakpoint.
 */

/** Where a step's frame is in its life. See the module docs for the loop. */
type StepFrame =
	| { kind: "queued" }
	/** `ticket` is monotonic per capture attempt, so the watchdog can tell
	 *  "still THIS capture" from "a newer one at the same index". */
	| { kind: "capturing"; ticket: number }
	| { kind: "mirrored"; srcdoc: string; capturedAt: number }
	/** Never settled or never loaded; the frame stays live instead. */
	| { kind: "restless" };

const QUEUED: StepFrame = { kind: "queued" };

function hora(timestamp: number): string {
	return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ThemedBoard({
	flow,
	steps,
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
}: {
	flow: Flow;
	steps: Array<{ step: Flow["steps"][number]; viewport: Viewport }>;
	scale: number;
	theme: "light" | "dark";
	nonce: number;
	editing: boolean;
	/** 0 is the sweep's board: captures happen here, never in the split twin. */
	slot: number;
	frames: StepFrame[];
	active: { step: number; slot: number } | null;
	onCapture: (step: number, frame: HTMLIFrameElement) => void;
	onActivate: (step: number, slot: number) => void;
	onRefresh: (step: number) => void;
	onDemote: () => void;
	registerLiveFrame: (step: number, slot: number, frame: HTMLIFrameElement | null) => void;
}) {
	const { config } = useManifest();
	return (
		<div>
			<ol className="flex items-start gap-4">
				{steps.map(({ step, viewport }, index) => {
					const state = frames[index] ?? QUEUED;
					const isActive = active !== null && active.step === index && active.slot === slot;
					const capturingHere = state.kind === "capturing" && slot === 0;
					// A restless step stays live in the sweep's board only — a
					// second live copy in the split twin would double exactly the
					// load the mirrors exist to avoid.
					const live = isActive || (state.kind === "restless" && slot === 0) || capturingHere;
					return (
						<Fragment key={`${flow.id}-${index}-${step.route}`}>
							<li className="shrink-0">
								<ScreenFrame
									viewport={viewport}
									scale={scale}
									label={`${index + 1}. ${step.label}`}
									editing={editing}
								>
									{live ? (
										<RouteFrame
											key={nonce}
											src={step.route}
											title={`${flow.title} · ${step.label}`}
											width={viewport.width}
											height={viewport.height}
											theme={theme}
											frameRef={(element) => registerLiveFrame(index, slot, element)}
											onLoad={capturingHere ? (frame) => onCapture(index, frame) : undefined}
										/>
									) : state.kind === "mirrored" ? (
										<MirrorFrame
											srcdoc={state.srcdoc}
											title={`${flow.title} · ${step.label} (espejo)`}
											width={viewport.width}
											height={viewport.height}
											theme={theme}
										/>
									) : (
										// Natural size, like the frame it stands in for — the
										// board scales it down, so the text is sized to survive
										// that.
										<div
											className="flex items-center justify-center bg-zinc-50 dark:bg-zinc-900"
											style={{ width: viewport.width, height: viewport.height }}
										>
											<p className="max-w-lg px-10 text-center text-2xl leading-relaxed text-zinc-400 dark:text-zinc-500">
												{state.kind === "capturing"
													? "Cargando la ruta real…"
													: state.kind === "restless"
														? "Sin espejo — el paso sigue en vivo en el tablero claro."
														: "En cola — cada paso se carga una sola vez y queda como espejo."}
											</p>
										</div>
									)}
								</ScreenFrame>
								{(isActive ||
									state.kind === "mirrored" ||
									state.kind === "restless" ||
									capturingHere) && (
									<div
										className="mt-2 flex flex-wrap items-center gap-2"
										style={{ width: Math.floor(viewport.width * scale) }}
									>
										{isActive ? (
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
													onClick={() => onActivate(index, slot)}
													title="Monta la página real para interactuar con ella."
												>
													Activar
												</button>
												<button
													type="button"
													className={CHIP}
													onClick={() => onRefresh(index)}
													title="Vuelve a cargar la ruta y captura un espejo nuevo."
												>
													Actualizar
												</button>
											</>
										) : state.kind === "restless" ? (
											<>
												<span
													className="text-[11px] text-amber-600 dark:text-amber-400"
													title="La página no terminó de asentarse, así que el cuadro sigue en vivo."
												>
													En vivo — sin espejo
												</span>
												<button type="button" className={CHIP} onClick={() => onRefresh(index)}>
													Reintentar espejo
												</button>
											</>
										) : (
											<span className="text-[11px] text-zinc-500 dark:text-zinc-400">
												Cargando…
											</span>
										)}
									</div>
								)}
								<div
									className="mt-2 flex items-start justify-between gap-2"
									style={{ width: Math.floor(viewport.width * scale) }}
								>
									{step.note && (
										<p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
											{step.note}
										</p>
									)}
									<span className="ml-auto flex shrink-0 items-center gap-2">
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
									</span>
								</div>
							</li>
							{index < steps.length - 1 && (
								<li
									aria-hidden
									className="shrink-0 self-center text-xl text-zinc-400 dark:text-zinc-600"
								>
									→
								</li>
							)}
						</Fragment>
					);
				})}
			</ol>
		</div>
	);
}

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
}) {
	const { config, stats } = useManifest();
	const [nonce, setNonce] = useState(0);
	const [viewport, setViewport] = useState<string>(initialViewport ?? AUTO);
	const [zoom, setZoom] = useState<Zoom>(initialZoom ?? "fit");
	const [theme, setTheme] = useState<ThemeMode>(initialTheme ?? "light");
	const pickRef = useRef<HTMLDivElement>(null);

	const [frames, setFrames] = useState<StepFrame[]>(() => flow.steps.map(() => QUEUED));
	const [active, setActive] = useState<{ step: number; slot: number } | null>(null);
	const liveFrames = useRef(new Map<string, HTMLIFrameElement>());

	// "Recargar cuadros" starts the sweep over. A new flow does not need to:
	// the panel is keyed by flow.id at its call site, so switching flows
	// remounts with fresh state — the effect version rendered the previous
	// flow's mirrors for one paint before it landed.
	useEffect(() => {
		setFrames(flow.steps.map(() => QUEUED));
		setActive(null);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [nonce]);

	// The sweep: one capture in flight, ever. The parallel version is the whole
	// bug this panel had — N simultaneous route loads is what filled the dev
	// server's heap — and strictly-sequential loads let every repeat route hit
	// the compile cache warm.
	const nextTicket = useRef(1);
	useEffect(() => {
		if (frames.some((frame) => frame.kind === "capturing")) return;
		if (!frames.some((frame) => frame.kind === "queued")) return;
		setFrames((current) => {
			if (current.some((frame) => frame.kind === "capturing")) return current;
			const next = current.findIndex((frame) => frame.kind === "queued");
			if (next === -1) return current;
			const ticket = nextTicket.current;
			nextTicket.current += 1;
			return current.map((frame, index) =>
				index === next ? { kind: "capturing", ticket } : frame,
			);
		});
	}, [frames]);

	// Watchdog: a frame whose route never even loads must not hold the rest of
	// the storyboard hostage. The step is marked restless — its frame stays
	// mounted and may still finish — and the sweep moves on. Keyed by the
	// capture's own ticket, NOT the frames array: depending on the whole array
	// restarted the 30 s timer every time the user touched any other step, so
	// a stuck capture was never timed out.
	const capturing = frames.findIndex((frame) => frame.kind === "capturing");
	const capturingEntry = capturing === -1 ? null : frames[capturing];
	const captureTicket = capturingEntry?.kind === "capturing" ? capturingEntry.ticket : null;
	useEffect(() => {
		if (capturing === -1 || captureTicket === null) return;
		const timer = setTimeout(() => {
			setFrames((current) =>
				current.map((frame, i) =>
					i === capturing && frame.kind === "capturing" && frame.ticket === captureTicket
						? { kind: "restless" }
						: frame,
				),
			);
		}, CAPTURE_TOTAL_MS);
		return () => clearTimeout(timer);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [capturing, captureTicket]);

	const onCapture = useCallback(
		(index: number, frame: HTMLIFrameElement) => {
			const route = flow.steps[index]?.route;
			if (!route) return;
			void captureMirror(frame, route)
				.then((srcdoc) => {
					setFrames((current) =>
						current.map((entry, i) => {
							// Only a step still capturing takes the result: a stale
							// resolution after Recargar or a StrictMode remount must
							// not overwrite a newer state.
							if (i !== index || entry.kind !== "capturing") return entry;
							return srcdoc
								? { kind: "mirrored", srcdoc, capturedAt: Date.now() }
								: { kind: "restless" };
						}),
					);
				})
				// captureMirror is defensively wrapped, but a throw inside the
				// state updater above would otherwise surface as an unhandled
				// rejection no boundary sees.
				.catch(() => {});
		},
		[flow],
	);

	// Demotion re-captures synchronously from the live document before the
	// frame unmounts, so the mirror left behind is as fresh as what the user
	// just saw — not the pre-activation snapshot.
	const onDemote = useCallback(() => {
		if (!active) return;
		const element = liveFrames.current.get(`${active.slot}:${active.step}`);
		const route = flow.steps[active.step]?.route;
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
					const step = active.step;
					setFrames((current) =>
						current.map((frame, index) =>
							index === step ? { kind: "mirrored", srcdoc, capturedAt } : frame,
						),
					);
				}
			} catch {
				// The step keeps its previous mirror rather than going blank.
			}
		}
		setActive(null);
	}, [active, flow]);

	const onActivate = useCallback(
		(step: number, slot: number) => {
			onDemote();
			setActive({ step, slot });
		},
		[onDemote],
	);

	const onRefresh = useCallback((step: number) => {
		setFrames((current) => current.map((frame, index) => (index === step ? QUEUED : frame)));
	}, []);

	const registerLiveFrame = useCallback(
		(step: number, slot: number, frame: HTMLIFrameElement | null) => {
			const key = `${slot}:${step}`;
			if (frame) liveFrames.current.set(key, frame);
			else liveFrames.current.delete(key);
		},
		[],
	);

	const override = viewport === AUTO ? null : viewportById(config, viewport);
	const steps = flow.steps.map((step) => ({
		step,
		viewport: override ?? viewportById(config, step.viewport),
	}));
	const naturalWidth = steps.reduce((total, { viewport: preset }) => total + preset.width, 0);
	// Every frame carries its own chrome, so the overhead grows with the number
	// of steps, not just with the gaps between them.
	const { ref: measureRef, scale } = useScale(
		zoom,
		naturalWidth,
		steps.length * FRAME_CHROME + Math.max(0, steps.length - 1) * STEP_GUTTER,
	);

	const themes: Array<"light" | "dark"> = theme === "split" ? ["light", "dark"] : [theme];

	useInspect(
		editing,
		useCallback(() => pickRef.current, []),
		componentIndex,
		{ onPin, onHover },
		// Frames appear as the sweep advances and on activation, and iframes are
		// instrumented only at attach time — the transitions have to be in here.
		`${flow.id}:${nonce}:${viewport}:${zoom}:${theme}:${frames
			.map((frame) => frame.kind.charAt(0))
			.join("")}:${active ? `${active.slot}.${active.step}` : "-"}`,
	);

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
							: `Rutas reales, los ${steps.length} pasos a ${override?.width}px, congeladas como espejos.`
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
								title="Descubierto siguiendo los enlaces reales de la app. Declara el recorrido en workbench.config.json para darle nombre y notas."
							>
								descubierto
							</span>
						)}
					</div>
					{flow.description && (
						<p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{flow.description}</p>
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

				<div ref={pickRef}>
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
									steps={steps}
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
								/>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
