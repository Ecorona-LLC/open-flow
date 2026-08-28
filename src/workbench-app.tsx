"use client";

import { useMemo, useState } from "react";
import { ManifestProvider } from "./config-context";
import { cx } from "./cx";
import { EditSessionOverlay, useEditSession } from "./edit-session";
import { buildComponentIndex } from "./hover-inspect";
import { byGroup, flowById, groupLabel } from "./manifest";
import type { Manifest } from "./manifest.types";
import { ComponentsPanel } from "./panels/components";
import { ElementsPanel } from "./panels/elements";
import { FlowsPanel } from "./panels/flows";
import { SurfacesPanel } from "./panels/surfaces";
import type { NewTicketInput, TicketSummary } from "./pin";
import type { RegistryEntry } from "./registry";
import type { Zoom } from "./screen-frame";
import type { ThemeMode } from "./screen-toolbar";
import { TicketDrawer, type CreateResult } from "./ticket-drawer";
import { VerdictBadge } from "./component-preview";

/**
 * The shell: a rail to choose what you are looking at, a panel showing it.
 *
 * The rail is **navigation only** — which component, which flow, which surface.
 * Edit mode and "abrir aislado" live in the toolbar, next to the screens they
 * act on; they used to sit here, which put verbs about the current view in the
 * column that changes the view.
 */
export type Tab = "elementos" | "componentes" | "flujos" | "superficies";

const TABS: Array<{ id: Tab; label: string }> = [
	{ id: "elementos", label: "Elementos" },
	{ id: "componentes", label: "Componentes" },
	{ id: "flujos", label: "Flujos" },
	{ id: "superficies", label: "Superficies" },
];

export interface WorkbenchView {
	tab?: string;
	component?: string;
	flow?: string;
	surface?: string;
	vp?: string;
	zoom?: string;
	theme?: string;
	chrome?: string;
}

function asTab(value: string | undefined): Tab {
	return TABS.some((tab) => tab.id === value) && value ? (value as Tab) : "componentes";
}

function asZoom(value: string | undefined): Zoom | undefined {
	if (value === "fit") return "fit";
	const parsed = Number(value);
	return parsed === 0.5 || parsed === 0.75 || parsed === 1 ? parsed : undefined;
}

function asTheme(value: string | undefined): ThemeMode | undefined {
	return value === "light" || value === "dark" || value === "split" ? value : undefined;
}

export function WorkbenchApp({
	manifest,
	registry,
	tickets,
	view,
	onCreateTicket,
}: {
	manifest: Manifest;
	registry: RegistryEntry[];
	tickets: TicketSummary[];
	view: WorkbenchView;
	onCreateTicket: (input: NewTicketInput) => Promise<CreateResult>;
}) {
	const [tab, setTab] = useState<Tab>(asTab(view.tab));
	const [componentId, setComponentId] = useState(view.component ?? manifest.components[0]?.id);
	const [flowId, setFlowId] = useState(view.flow ?? manifest.flows[0]?.id);
	const [surfaceId, setSurfaceId] = useState(view.surface ?? manifest.surfaces[0]?.id);
	const [filter, setFilter] = useState("");

	const session = useEditSession({ bareKeys: true });
	const componentIndex = useMemo(
		() => buildComponentIndex(manifest.components),
		[manifest.components],
	);

	const showChrome = view.chrome !== "off";
	const component =
		manifest.components.find((entry) => entry.id === componentId) ?? manifest.components[0];
	const flow = flowById(manifest.flows, flowId);
	const surface = manifest.surfaces.find((entry) => entry.id === surfaceId) ?? manifest.surfaces[0];

	const shared = {
		componentIndex,
		editing: session.editing,
		onPin: session.addPin,
		onHover: session.setHovering,
		onToggleEdit: session.toggleEditing,
		pinCount: session.pins.length,
		onOpenRequest: session.openDrawer,
		showChrome,
		initialViewport: view.vp,
		initialZoom: asZoom(view.zoom),
		initialTheme: asTheme(view.theme),
	};

	const needle = filter.trim().toLowerCase();
	// Memoized: this runs on EVERY keystroke into the filter box, and the
	// grouping below re-walks whatever this returns.
	const visible = useMemo(
		() =>
			needle
				? manifest.components.filter(
						(entry) =>
							entry.name.toLowerCase().includes(needle) ||
							entry.file.toLowerCase().includes(needle),
					)
				: manifest.components,
		[manifest.components, needle],
	);
	const grouped = useMemo(() => byGroup(visible), [visible]);

	const panel = (() => {
		if (tab === "elementos") return <ElementsPanel />;
		if (tab === "flujos") {
			return flow ? (
				// Keyed by flow: the panel's frames state is per-flow, and a
				// keyless switch rendered the previous flow's mirrors for one
				// paint before the reset effect landed.
				<FlowsPanel key={flow.id} flow={flow} {...shared} />
			) : (
				<Empty what="recorridos" hint="El rastreador no encontró enlaces entre páginas." />
			);
		}
		if (tab === "superficies") {
			return surface ? (
				<SurfacesPanel surface={surface} tickets={tickets} />
			) : (
				<Empty
					what="superficies"
					hint="Nada bajo el directorio de la app importa una cabecera, un rail o una barra lateral."
				/>
			);
		}
		return component ? (
			<ComponentsPanel entry={component} registry={registry} {...shared} />
		) : (
			<Empty what="componentes" hint="Revisa `componentRoots` en workbench.config.json." />
		);
	})();

	return (
		<ManifestProvider manifest={manifest}>
			<div className="fixed inset-0 flex bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
				{showChrome && (
					<nav className="flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
						<header className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
							{/* The product is the title; the host project is the line under
							    it. `config.title` names the project (the scanner defaults it
							    to the package name), and the tagline in `config.subtitle`
							    moved to a tooltip — two lines was the whole brief. */}
							<h1 className="text-sm font-semibold" title={manifest.config.subtitle}>
								Open-Flow
							</h1>
							<p className="mt-0.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
								{manifest.config.title}
							</p>
						</header>

						<div className="flex flex-wrap gap-1 border-b border-zinc-200 p-2 dark:border-zinc-700">
							{TABS.map((entry) => (
								<button
									key={entry.id}
									type="button"
									onClick={() => setTab(entry.id)}
									className={cx(
										"rounded px-2 py-1 text-[11px] font-medium",
										entry.id === tab
											? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
											: "text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800",
									)}
								>
									{entry.label}
								</button>
							))}
						</div>

						<div className="min-h-0 flex-1 overflow-auto p-2">
							{tab === "componentes" && (
								<>
									<input
										value={filter}
										onChange={(event) => setFilter(event.target.value)}
										placeholder={`Filtrar ${manifest.components.length}…`}
										className="mb-2 w-full rounded border border-zinc-300 px-2 py-1 text-[11px] dark:border-zinc-700 dark:bg-zinc-800"
									/>
									{grouped.map(([group, entries]) => (
										<section key={group} className="mb-3">
											<h2 className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
												{groupLabel(manifest.config, group)}
											</h2>
											{entries.map((entry) => (
												<button
													key={entry.id}
													type="button"
													onClick={() => setComponentId(entry.id)}
													className={cx(
														"flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[12px]",
														entry.id === component?.id
															? "bg-zinc-200 font-medium dark:bg-zinc-800"
															: "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
													)}
												>
													<span className="truncate">{entry.name}</span>
													{entry.verdict !== "auto" && (
														<span className="ml-auto shrink-0">
															<VerdictBadge verdict={entry.verdict} />
														</span>
													)}
												</button>
											))}
										</section>
									))}
								</>
							)}

							{tab === "flujos" &&
								manifest.flows.map((entry) => (
									<button
										key={entry.id}
										type="button"
										onClick={() => setFlowId(entry.id)}
										className={cx(
											"block w-full truncate rounded px-2 py-1 text-left text-[12px]",
											entry.id === flow?.id
												? "bg-zinc-200 font-medium dark:bg-zinc-800"
												: "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
										)}
									>
										{entry.title}
									</button>
								))}

							{tab === "superficies" &&
								manifest.surfaces.map((entry) => (
									<button
										key={entry.id}
										type="button"
										onClick={() => setSurfaceId(entry.id)}
										className={cx(
											"block w-full truncate rounded px-2 py-1 text-left text-[12px]",
											entry.id === surface?.id
												? "bg-zinc-200 font-medium dark:bg-zinc-800"
												: "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
										)}
									>
										{entry.label}
									</button>
								))}
						</div>

						<footer className="border-t border-zinc-200 px-3 py-2 text-[10px] text-zinc-400 dark:border-zinc-700">
							{manifest.stats.filesScanned} archivos · {manifest.stats.elapsedMs} ms ·{" "}
							{manifest.generatedBy}
							{manifest.stats.parseFailures.length > 0 && (
								<span className="block text-amber-600 dark:text-amber-400">
									{manifest.stats.parseFailures.length} archivos no se analizaron
								</span>
							)}
						</footer>
					</nav>
				)}

				<main className="min-w-0 flex-1">{panel}</main>
			</div>

			<EditSessionOverlay session={session} />
			<TicketDrawer
				session={session}
				// The drawer takes the narrow shape the overlay also uses, so one
				// component serves both without the live path carrying the full map.
				surfaces={manifest.surfaces.map((surface) => ({
					id: surface.id,
					label: surface.label,
					weight: surface.weight,
					predictedFileCount: surface.predictedFiles.length,
				}))}
				onCreate={onCreateTicket}
			/>
		</ManifestProvider>
	);
}

function Empty({ what, hint }: { what: string; hint: string }) {
	return (
		<div className="flex h-full items-center justify-center p-10">
			<p className="max-w-sm text-center text-sm text-zinc-500 dark:text-zinc-400">
				No se encontraron {what}. {hint}
			</p>
		</div>
	);
}
