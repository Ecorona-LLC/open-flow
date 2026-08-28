"use client";

import { useState } from "react";
import { cx } from "./cx";
import type { EditSession } from "./edit-session";
import { surfaceFromPins } from "./manifest";
import type { OverlaySurface } from "./manifest.types";
import type { NewTicketInput, RuntimeError } from "./pin";

/**
 * All the drawer ever needed from a surface: what to call it, how much process
 * the change deserves, and how many files that covers. Narrowed to this so the
 * live overlay can hand it a trimmed list instead of the full map, which is
 * imported by every route in the host app.
 */
export type DrawerSurface = OverlaySurface;

/**
 * Writing the ticket.
 *
 * There is **no surface picker** here on purpose: you already said which
 * surface this is by pointing at it. The drawer shows what it inferred and lets
 * you correct it only when the pins disagree with each other.
 *
 * The size is inferred too. One surface, few files, one variant produces a
 * short ticket — *Qué* and *Validar*. Anything wider earns the four phases.
 * Centering a div should not produce a strategy document, and re-theming three
 * headers should not be a one-liner; the thing you pointed at already knows
 * which it is.
 */
export interface CreateResult {
	ok: boolean;
	id?: string;
	file?: string;
	prompt?: string;
	error?: string;
}

export function TicketDrawer({
	session,
	surfaces,
	route,
	onCreate,
}: {
	session: EditSession;
	surfaces: DrawerSurface[];
	/** The route you were picking on, when there is one. */
	route?: string;
	onCreate: (input: NewTicketInput) => Promise<CreateResult>;
}) {
	const [title, setTitle] = useState("");
	const [intent, setIntent] = useState("");
	const [acceptance, setAcceptance] = useState("");
	const [attachErrors, setAttachErrors] = useState(true);
	const [busy, setBusy] = useState(false);
	const [result, setResult] = useState<CreateResult | null>(null);
	const [override, setOverride] = useState<string | null>(null);

	if (!session.drawerOpen) return null;

	const fallback = surfaces[0]?.id ?? "";
	const inferred = surfaceFromPins(session.pins, fallback);
	const surfaceId = override ?? inferred;
	const surface = surfaces.find((item) => item.id === surfaceId);

	// More than one surface among the pins means the inference is a guess worth
	// showing, not a fact worth hiding.
	const pinned = new Set(
		session.pins.map((pin) => pin.node?.surface).filter((id): id is string => Boolean(id)),
	);
	const ambiguous = pinned.size > 1;

	const submit = async () => {
		if (!title.trim() || busy) return;
		setBusy(true);
		const errors: RuntimeError[] = attachErrors ? session.errors : [];
		try {
			const created = await onCreate({
				surface: surfaceId,
				title: title.trim(),
				intent,
				acceptance,
				pins: session.pins,
				errors,
				...(route ? { route } : {}),
			});
			setResult(created);
			if (created.ok) {
				setTitle("");
				setIntent("");
				setAcceptance("");
				session.clearPins();
			}
		} catch (error) {
			// The noop action THROWS by design, and any Server Action can
			// reject on a network blip. Without this catch the drawer read
			// "Escribiendo…" forever and the typed ticket was unrecoverable.
			setResult({
				ok: false,
				error: error instanceof Error ? error.message : "Falló la escritura.",
			});
		} finally {
			setBusy(false);
		}
	};

	return (
		<aside
			role="dialog"
			aria-modal="true"
			aria-labelledby="workbench-drawer-title"
			// Escape closes from anywhere inside — the global handler skips
			// keystrokes while typing, which in a drawer is the whole time.
			onKeyDown={(event) => {
				if (event.key === "Escape") session.closeDrawer();
			}}
			className="fixed right-0 top-0 z-[2147483100] flex h-full w-[26rem] flex-col border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
		>
			<header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
				<div>
					<h2
						id="workbench-drawer-title"
						className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
					>
						Solicitud de cambio
					</h2>
					<p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
						{surface ? (
							<>
								{surface.label} · {surface.weight === "quick" ? "ticket corto" : "ticket completo"}{" "}
								· {surface.predictedFileCount} archivos predichos
							</>
						) : (
							"Sin superficie"
						)}
					</p>
				</div>
				<button
					type="button"
					onClick={session.closeDrawer}
					className="rounded px-2 py-1 text-[11px] text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
				>
					Cerrar
				</button>
			</header>

			<div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
				{ambiguous && (
					<div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px] dark:border-amber-800 dark:bg-amber-950">
						<p className="text-amber-900 dark:text-amber-100">
							Señalaste elementos de más de una superficie.
						</p>
						<select
							value={surfaceId}
							onChange={(event) => setOverride(event.target.value)}
							className="mt-1 w-full rounded border border-amber-300 bg-white px-1 py-0.5 text-[11px] dark:border-amber-800 dark:bg-zinc-900"
						>
							{[...pinned].map((id) => (
								<option key={id} value={id}>
									{surfaces.find((item) => item.id === id)?.label ?? id}
								</option>
							))}
						</select>
					</div>
				)}

				<label className="block">
					<span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
						Título
					</span>
					<input
						value={title}
						onChange={(event) => setTitle(event.target.value)}
						placeholder="Unificar el gris de la barra superior"
						// The drawer opens on the first pin; landing focus on the
						// title is what makes pick-then-type a single gesture.
						autoFocus
						className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-[13px] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
					/>
				</label>

				<label className="block">
					<span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
						Qué cambia
					</span>
					<textarea
						value={intent}
						onChange={(event) => setIntent(event.target.value)}
						rows={3}
						placeholder="Una o dos líneas. Qué está mal y qué debería pasar."
						className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-[13px] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
					/>
				</label>

				<label className="block">
					<span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
						Cómo se valida
					</span>
					<textarea
						value={acceptance}
						onChange={(event) => setAcceptance(event.target.value)}
						rows={3}
						placeholder={
							"Una línea por criterio.\nSe vuelve una lista que `workbench validate` cuenta."
						}
						className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-[13px] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
					/>
				</label>

				<section>
					<h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
						Señalado {session.pins.length > 0 && `(${session.pins.length})`}
					</h3>
					{session.pins.length === 0 ? (
						<p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
							Activa <strong>Editar</strong> y haz clic en lo que quieres cambiar. Cada clic guarda
							el componente y su archivo, no una descripción.
						</p>
					) : (
						<ul className="mt-1 space-y-2">
							{session.pins.map((pin, index) => (
								<li
									key={`${pin.element.path}-${index}`}
									className="rounded-md border border-zinc-200 p-2 dark:border-zinc-700"
								>
									<p className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
										{pin.node
											? `${pin.node.component}${pin.node.file ? ` · ${pin.node.file}` : ""}`
											: `<${pin.element.tag}>`}
									</p>
									{pin.element.text && (
										<p className="mt-0.5 truncate text-[11px] text-zinc-600 dark:text-zinc-300">
											“{pin.element.text}”
										</p>
									)}
									<div className="mt-1 flex gap-2">
										<input
											value={pin.note}
											onChange={(event) => session.updatePin(index, event.target.value)}
											placeholder="qué le pasa a esto"
											className="w-full rounded border border-zinc-200 px-1.5 py-1 text-[11px] dark:border-zinc-700 dark:bg-zinc-800"
										/>
										<button
											type="button"
											onClick={() => session.removePin(index)}
											className="shrink-0 rounded px-1.5 text-[11px] text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
										>
											quitar
										</button>
									</div>
								</li>
							))}
						</ul>
					)}
				</section>

				{session.errors.length > 0 && (
					<section className="rounded-md border border-red-200 bg-red-50 p-2 dark:border-red-900 dark:bg-red-950">
						<label className="flex items-center gap-2 text-[11px] text-red-900 dark:text-red-200">
							<input
								type="checkbox"
								checked={attachErrors}
								onChange={(event) => setAttachErrors(event.target.checked)}
							/>
							Adjuntar {session.errors.length} error
							{session.errors.length === 1 ? "" : "es"} de runtime
						</label>
						<ul className="mt-1 space-y-0.5 font-mono text-[10px] text-red-800 dark:text-red-300">
							{session.errors.slice(0, 3).map((error) => (
								<li key={`${error.at}-${error.message}`} className="truncate">
									{error.file ?? error.route ?? "?"} — {error.message}
								</li>
							))}
						</ul>
					</section>
				)}

				{result && (
					<div
						className={cx(
							"rounded-md border p-2 text-[11px]",
							result.ok
								? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950"
								: "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950",
						)}
					>
						{result.ok ? (
							<>
								<p className="font-medium text-emerald-900 dark:text-emerald-100">
									{result.id} · {result.file}
								</p>
								{result.prompt && (
									<>
										<p className="mt-1 text-emerald-800 dark:text-emerald-200">
											Pásale esto al agente:
										</p>
										<textarea
											readOnly
											value={result.prompt}
											rows={4}
											onFocus={(event) => event.currentTarget.select()}
											className="mt-1 w-full rounded border border-emerald-300 bg-white p-1 font-mono text-[10px] dark:border-emerald-800 dark:bg-zinc-900"
										/>
									</>
								)}
							</>
						) : (
							<p className="text-red-900 dark:text-red-100">{result.error}</p>
						)}
					</div>
				)}
			</div>

			<footer className="border-t border-zinc-200 p-3 dark:border-zinc-700">
				<button
					type="button"
					onClick={submit}
					disabled={!title.trim() || busy}
					className="w-full rounded-md bg-zinc-900 px-3 py-2 text-[12px] font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
				>
					{busy ? "Escribiendo…" : "Escribir el ticket"}
				</button>
			</footer>
		</aside>
	);
}
