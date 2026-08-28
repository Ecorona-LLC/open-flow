"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ComponentPreview, ScenarioPreview } from "./component-preview";
import { ManifestProvider } from "./config-context";
import { useInspect } from "./edit-mode";
import { EditSessionOverlay, useEditSession } from "./edit-session";
import { InlineSurface, RouteFrame } from "./frame";
import { buildComponentIndex } from "./hover-inspect";
import { viewportById, workbenchUrl } from "./manifest";
import type { Manifest } from "./manifest.types";
import { PickBox } from "./pick-box";
import { indexRegistry, type RegistryEntry } from "./registry";
import { ScreenFrame, useScale, FRAME_CHROME, type Zoom } from "./screen-frame";
import { AUTO, ScreenToolbar, type ThemeMode } from "./screen-toolbar";

/**
 * One screen, alone: a component or a route, with no rail and no panel.
 *
 * Two jobs. It is what a device preset renders *into* — Componentes points an
 * iframe here so the width inside is genuinely 390px and Tailwind's breakpoints
 * are truthful — and it is what "abrir aislado" opens, for looking and
 * screenshotting with the rail's width given back.
 *
 * It carries the same toolbar as the panels, including edit mode. Picking works
 * here for the same reason it works in a flow frame: the realm-agnostic element
 * check in `dom-realm`.
 */
export function FrameView({
	manifest,
	registry,
	componentId,
	route,
	viewport: initialViewport,
	theme: initialTheme,
	scenario,
}: {
	manifest: Manifest;
	registry: RegistryEntry[];
	componentId?: string;
	route?: string;
	viewport?: string;
	theme?: string;
	scenario?: string;
}) {
	const config = manifest.config;
	const [viewport, setViewport] = useState<string>(initialViewport ?? AUTO);
	const [zoom, setZoom] = useState<Zoom>("fit");
	const [mode, setMode] = useState<ThemeMode>(
		initialTheme === "dark" || initialTheme === "split" ? initialTheme : "light",
	);
	const session = useEditSession({ bareKeys: true });
	const pickRef = useRef<HTMLDivElement>(null);
	// Rebuilt only when the manifest changes — this view re-renders on every
	// zoom/viewport/theme keypress, and the index walks every component.
	const componentIndex = useMemo(
		() => buildComponentIndex(manifest.components),
		[manifest.components],
	);

	const entry = manifest.components.find((item) => item.id === componentId);
	const preset = viewport === AUTO ? null : viewportById(config, viewport);
	const { ref: measureRef, scale } = useScale(zoom, preset?.width ?? 0, FRAME_CHROME);
	const theme: "light" | "dark" = mode === "dark" ? "dark" : "light";

	useInspect(
		session.editing,
		useCallback(() => pickRef.current, []),
		componentIndex,
		{ onPin: session.addPin, onHover: session.setHovering },
		`${componentId ?? route}:${viewport}:${zoom}:${theme}`,
	);

	// `?scenario=` names a section, and the frame must render that section: the
	// device previews link one iframe per section, and every one of them used to
	// show the main preview whatever its header claimed.
	const rendered = entry ? (
		scenario ? (
			<ScenarioPreview
				entry={entry}
				registry={indexRegistry(registry).get(entry.id)}
				scenario={scenario}
			/>
		) : (
			<ComponentPreview entry={entry} registry={indexRegistry(registry).get(entry.id)} />
		)
	) : (
		<p className="p-6 text-sm text-zinc-500">
			Nada que mostrar. Falta <code>?component=</code> o <code>?route=</code>.
		</p>
	);

	// The screen components own the pickable box, so callers cannot place it on
	// the tool's own chrome. The one exception below is commented where it is.
	const body = (() => {
		if (route) {
			return preset ? (
				<ScreenFrame viewport={preset} scale={scale} label={route} editing={session.editing}>
					<RouteFrame src={route} title={route} width={preset.width} height={preset.height} />
				</ScreenFrame>
			) : (
				// A window-filling route frame: no screen component fits, so this
				// is the only place a box is still placed by hand.
				<PickBox enabled={session.editing} className="h-full">
					<iframe src={route} title={route} className="h-full w-full border-0" />
				</PickBox>
			);
		}
		return preset ? (
			<ScreenFrame viewport={preset} scale={scale} label={entry?.name} editing={session.editing}>
				<InlineSurface theme={theme} editing={false}>
					{rendered}
				</InlineSurface>
			</ScreenFrame>
		) : (
			<InlineSurface theme={theme} editing={session.editing}>
				{rendered}
			</InlineSurface>
		);
	})();

	return (
		<ManifestProvider manifest={manifest}>
			<div className={theme === "dark" ? "dark" : undefined}>
				<div className="flex h-screen flex-col bg-white dark:bg-zinc-900">
					<ScreenToolbar
						viewport={viewport}
						onViewport={setViewport}
						zoom={zoom}
						onZoom={setZoom}
						theme={mode}
						onTheme={setMode}
						zoomEnabled={preset !== null}
						identity={route ?? (scenario ? `${entry?.name} · ${scenario}` : entry?.name)}
						backHref={workbenchUrl(config, "")}
						editing={session.editing}
						onToggleEdit={session.toggleEditing}
						pinCount={session.pins.length}
					/>
					<div ref={measureRef} className="min-h-0 flex-1 overflow-auto">
						<div ref={pickRef} className="h-full p-4">
							{body}
						</div>
					</div>
				</div>
			</div>
			<EditSessionOverlay session={session} />
		</ManifestProvider>
	);
}
