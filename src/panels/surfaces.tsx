"use client";

import { useManifest } from "../config-context";
import { cx } from "../cx";
import type { Surface } from "../manifest.types";
import type { TicketSummary } from "../pin";

/**
 * Superficies — what each named part of the product is made of.
 *
 * The point of this tab is the two halves people forget: `absent` (where the
 * surface deliberately is not, so a change that looks done isn't) and the
 * literal colours that bypass the token system.
 *
 * There is no surface picker in the ticket drawer, because you say which
 * surface you mean by pointing at it in edit mode. This tab is for reading the
 * map, not for selecting against it.
 */
function Block({
	title,
	items,
	tone,
	mono = true,
}: {
	title: string;
	items: string[];
	tone?: string;
	mono?: boolean;
}) {
	if (items.length === 0) return null;
	return (
		<section className="mb-5">
			<h4 className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
				{title} <span className="text-zinc-300 dark:text-zinc-600">{items.length}</span>
			</h4>
			<ul
				className={cx(
					"space-y-0.5 text-[11px]",
					mono && "font-mono",
					tone ?? "text-zinc-600 dark:text-zinc-400",
				)}
			>
				{items.map((item) => (
					<li key={item}>{item}</li>
				))}
			</ul>
		</section>
	);
}

export function SurfacesPanel({
	surface,
	tickets,
}: {
	surface: Surface;
	tickets: TicketSummary[];
}) {
	const { components } = useManifest();
	const mine = tickets.filter((ticket) => ticket.surface === surface.id);
	const covered = new Set(surface.components);
	const uncovered = components.filter(
		(component) => component.surface === surface.id && !covered.has(component.id),
	);

	return (
		<div className="min-h-0 flex-1 overflow-auto bg-zinc-50 p-6 dark:bg-zinc-950">
			<header className="mb-6 max-w-2xl">
				<div className="flex flex-wrap items-center gap-2">
					<h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
						{surface.label}
					</h2>
					<code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
						{surface.id}
					</code>
					<span
						className={cx(
							"rounded px-1.5 py-0.5 text-[10px] font-medium",
							surface.weight === "quick"
								? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
								: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
						)}
						title={
							surface.weight === "quick"
								? "Un cambio aquí es corto: qué y validar, nada más."
								: "Un cambio aquí toca varios archivos o variantes: estrategia, plan, ejecutar, validar."
						}
					>
						{surface.weight === "quick" ? "cambio corto" : "cambio amplio"}
					</span>
					{surface.origin === "spider" && (
						<span
							className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
							title="Propuesta por el rastreador. Dale nombre en workbench.surfaces.json y pasa a ser tuya."
						>
							descubierta
						</span>
					)}
				</div>
				{surface.description && (
					<p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{surface.description}</p>
				)}
				{surface.main && (
					<p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
						Empieza aquí:{" "}
						<code className="font-mono text-zinc-700 dark:text-zinc-300">{surface.main}</code>
					</p>
				)}
			</header>

			{surface.gotchas.length > 0 && (
				<div className="mb-6 max-w-2xl rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
					<h4 className="text-[10px] font-medium uppercase tracking-wider text-amber-800 dark:text-amber-200">
						Ojo
					</h4>
					<ul className="mt-1 space-y-1 text-[12px] text-amber-900 dark:text-amber-100">
						{surface.gotchas.map((gotcha) => (
							<li key={gotcha}>— {gotcha}</li>
						))}
					</ul>
				</div>
			)}

			<div className="grid max-w-5xl gap-x-10 md:grid-cols-2">
				<div>
					<Block title="Variantes — cambiar una sola las descuadra" items={surface.files.anchors} />
					<Block title="Partes" items={surface.files.members} />
					<Block
						title="Aprendido de tickets"
						items={surface.files.learned.map((item) =>
							item.ticket ? `${item.file} · ${item.ticket}` : item.file,
						)}
					/>
					<Block title="Se monta en" items={surface.files.mounts} />
					<Block title="Rutas" items={surface.routes} />
				</div>

				<div>
					{surface.absent.length > 0 && (
						<section className="mb-5">
							<h4 className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
								No existe en
							</h4>
							{/* The half of the map that stops a change from looking
							    finished when four route groups still render the old thing. */}
							<p className="font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
								{surface.absent.join("  ")}
							</p>
						</section>
					)}

					{surface.tokens.length > 0 && (
						<section className="mb-5">
							<h4 className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
								Colores que lo pintan
							</h4>
							<ul className="space-y-0.5 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
								{surface.tokens.map((use) => (
									<li key={use.token}>
										{use.token} <span className="text-zinc-400">×{use.uses}</span>
									</li>
								))}
							</ul>
						</section>
					)}

					{surface.hardcodedColors.length > 0 && (
						<section className="mb-5">
							<h4 className="mb-1 text-[10px] font-medium uppercase tracking-wider text-amber-600 dark:text-amber-400">
								Colores literales — se saltan el token
							</h4>
							<ul className="space-y-0.5 font-mono text-[11px] text-amber-700 dark:text-amber-300">
								{surface.hardcodedColors.map((entry) => (
									<li key={entry.file}>
										{entry.file} — {entry.values.join(" ")}
									</li>
								))}
							</ul>
						</section>
					)}

					<Block title="Primitivos compartidos — no editar a la ligera" items={surface.shared} />
					<Block title="Lógica que llama" items={surface.logic} />
					<Block title="Componentes en el taller" items={surface.components} mono={false} />
					{uncovered.length > 0 && (
						<Block
							title="Sin cubrir"
							items={uncovered.map((component) => `${component.name} (${component.verdict})`)}
							mono={false}
							tone="text-zinc-500 dark:text-zinc-500"
						/>
					)}
				</div>
			</div>

			{mine.length > 0 && (
				<section className="mt-6 max-w-2xl">
					<h4 className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
						Tickets
					</h4>
					<ul className="space-y-1 text-[12px]">
						{mine.map((ticket) => (
							<li key={ticket.id} className="flex items-baseline gap-2">
								<code className="font-mono text-[11px] text-zinc-500">{ticket.id}</code>
								<span className="text-zinc-700 dark:text-zinc-300">{ticket.title}</span>
								<span className="text-[10px] text-zinc-400">
									{ticket.status}
									{ticket.misses > 0 && ` · enseñó ${ticket.misses}`}
								</span>
							</li>
						))}
					</ul>
				</section>
			)}
		</div>
	);
}
