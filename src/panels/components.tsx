"use client";

import { useCallback, useRef, useState } from "react";
import {
	ComponentPreview,
	ComponentScenarios,
	VariantScenarios,
	VerdictBadge,
} from "../component-preview";
import { useManifest } from "../config-context";
import { useInspect } from "../edit-mode";
import { InlineSurface, RouteFrame } from "../frame";
import type { ComponentIndex } from "../hover-inspect";
import { frameUrl, viewportById } from "../manifest";
import type { ComponentEntry, Viewport } from "../manifest.types";
import type { PickTarget } from "../pick-highlight";
import type { Pin } from "../pin";
import { FRAME_CHROME, ScreenFrame, useScale, type Zoom } from "../screen-frame";
import { AUTO, ScreenToolbar, type ThemeMode } from "../screen-toolbar";
import { indexRegistry, type RegistryEntry } from "../registry";

/**
 * Componentes — the real components, rendered by importing them.
 *
 * Inline vs. iframe is not a style choice. Tailwind breakpoints resolve against
 * the **viewport**, so a 390px-wide `<div>` still paints desktop styles — the
 * classic Storybook lie. In *Auto* the component renders inline (fast, and the
 * real DOM is there for devtools); picking a device preset swaps to an iframe of
 * the isolated frame route, where the width is genuinely 390px.
 *
 * Shares its toolbar with Flujos, down to the labels.
 */
function ClickToLoadFrame({
	src,
	title,
	viewport,
	scale,
	editing,
	onLoaded,
}: {
	src: string;
	title: string;
	viewport: Viewport;
	scale: number;
	editing: boolean;
	/** Fired per load so the panel can re-attach inspection to the new frame. */
	onLoaded: () => void;
}) {
	const [mounted, setMounted] = useState(false);
	return (
		<ScreenFrame viewport={viewport} scale={scale} label={title} editing={editing}>
			{mounted ? (
				<RouteFrame
					src={src}
					title={title}
					width={viewport.width}
					height={viewport.height}
					onLoad={onLoaded}
				/>
			) : (
				// Natural size, scaled down by the board — hence the outsized text.
				<div
					className="flex flex-col items-center justify-center gap-6 bg-zinc-50 dark:bg-zinc-900"
					style={{ width: viewport.width, height: viewport.height }}
				>
					<p className="max-w-lg px-10 text-center text-2xl leading-relaxed text-zinc-400 dark:text-zinc-500">
						Cada vista es un iframe de la página aislada; se cargan al pedirlas para no multiplicar
						cargas del servidor.
					</p>
					<button
						type="button"
						onClick={() => setMounted(true)}
						className="rounded-xl border border-zinc-300 px-8 py-4 text-2xl font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
					>
						Cargar esta vista
					</button>
				</div>
			)}
		</ScreenFrame>
	);
}

export function ComponentsPanel({
	entry,
	registry,
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
	entry: ComponentEntry;
	registry: RegistryEntry[];
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
	const manifest = useManifest();
	const config = manifest.config;
	const [viewport, setViewport] = useState<string>(initialViewport ?? AUTO);
	const [zoom, setZoom] = useState<Zoom>(initialZoom ?? "fit");
	const [theme, setTheme] = useState<ThemeMode>(initialTheme ?? "light");
	const pickRef = useRef<HTMLDivElement>(null);

	const byId = indexRegistry(registry);
	const found = byId.get(entry.id);
	const inline = viewport === AUTO;
	const preset = inline ? null : viewportById(config, viewport);

	const { ref: measureRef, scale } = useScale(zoom, preset?.width ?? 0, FRAME_CHROME);
	const themes: Array<"light" | "dark"> = theme === "split" ? ["light", "dark"] : [theme];

	// Click-to-load section frames mount after inspection attached, and iframes
	// are instrumented only at attach time — each load has to bump the key.
	const [frameEpoch, setFrameEpoch] = useState(0);
	const onFrameLoaded = useCallback(() => setFrameEpoch((value) => value + 1), []);

	// Re-attach on everything that remounts a frame: a viewport override, a zoom
	// change, a second themed board, a different component, a late section frame.
	useInspect(
		editing,
		useCallback(() => pickRef.current, []),
		componentIndex,
		{ onPin, onHover },
		`${entry.id}:${viewport}:${zoom}:${theme}:${frameEpoch}`,
	);

	// Per board, not `themes[0]`: in split the dark board's URL used to say
	// `theme=light`, so both boards rendered the same theme.
	const isolatedFor = (mode: "light" | "dark", scenario?: string) =>
		frameUrl(config, {
			component: entry.id,
			viewport: preset?.id ?? config.viewports[0]?.id ?? "",
			theme: mode,
			...(scenario ? { scenario } : {}),
		});

	const section = (label: string, description: string | undefined, body: React.ReactNode) => (
		<section className="mb-8">
			<header className="mb-2 flex items-baseline gap-3">
				<h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{label}</h3>
				{description && (
					<p className="text-[11px] text-zinc-500 dark:text-zinc-400">{description}</p>
				)}
			</header>
			{body}
		</section>
	);

	// In device-preset mode the `body` is rendered by the isolated frame route,
	// not here — the iframe exists precisely because an inline render would lie
	// about breakpoints. Named sections carry their name in the URL and load on
	// demand: every section used to mount an iframe of the SAME url eagerly, so
	// a component with four sections cost four identical nested workbench page
	// loads, each of which showed the main preview whatever the header claimed.
	const surface = (mode: "light" | "dark", body: React.ReactNode, sectionName?: string) =>
		inline ? (
			<InlineSurface theme={mode} editing={editing}>
				{body}
			</InlineSurface>
		) : sectionName ? (
			<ClickToLoadFrame
				src={isolatedFor(mode, sectionName)}
				title={`${entry.name} · ${sectionName}`}
				viewport={preset ?? viewportById(config, undefined)}
				scale={scale}
				editing={editing}
				onLoaded={onFrameLoaded}
			/>
		) : (
			<ScreenFrame
				viewport={preset ?? viewportById(config, undefined)}
				scale={scale}
				label={entry.name}
				editing={editing}
			>
				<RouteFrame
					key={`${mode}-${preset?.id}`}
					src={isolatedFor(mode)}
					title={`${entry.name} · ${preset?.label ?? ""}`}
					width={preset?.width ?? 0}
					height={preset?.height ?? 0}
				/>
			</ScreenFrame>
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
					zoomEnabled={!inline}
					hint={
						inline
							? "En Auto se dibuja en línea: rápido, pero los breakpoints de Tailwind responden al ancho de la ventana, no al del cuadro."
							: `Dentro de un iframe a ${preset?.width}px reales, así que los breakpoints son de verdad.`
					}
					editing={editing}
					onToggleEdit={onToggleEdit}
					pinCount={pinCount}
					onOpenRequest={onOpenRequest}
					isolatedBase={{ tab: "componentes", component: entry.id }}
				/>
			)}

			<div
				ref={measureRef}
				className="min-h-0 flex-1 overflow-auto bg-zinc-50 p-6 dark:bg-zinc-950"
			>
				<header className="mb-5 max-w-2xl">
					<div className="flex items-center gap-2">
						<h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{entry.name}</h2>
						<VerdictBadge verdict={entry.verdict} />
					</div>
					<p className="mt-1 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
						{entry.file}
					</p>
					{entry.surface && (
						<p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
							Superficie: <span className="font-medium">{entry.surface}</span>
						</p>
					)}
				</header>

				<div ref={pickRef} className="space-y-8">
					{themes.map((mode) => (
						<div key={mode}>
							{themes.length > 1 && (
								<p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
									{mode === "light" ? "Claro" : "Oscuro"}
								</p>
							)}
							{section(
								"Vista principal",
								undefined,
								surface(mode, <ComponentPreview entry={entry} registry={found} />),
							)}
							<VariantScenarios
								entry={entry}
								registry={found}
								render={(name, description, node) =>
									section(name, description, surface(mode, node, name))
								}
							/>
							<ComponentScenarios
								entry={entry}
								registry={found}
								render={(name, description, node) =>
									section(name, description, surface(mode, node, name))
								}
							/>
						</div>
					))}
				</div>

				{/* The whole view, chrome-free, is the toolbar's button. This one
				    opens a single scenario — a different job, so it stays. */}
				<a
					href={isolatedFor(themes[0] ?? "light")}
					target="_blank"
					rel="noreferrer"
					className="text-[11px] text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
				>
					abrir aislado ↗
				</a>
			</div>
		</div>
	);
}
