"use client";

import { useState } from "react";
import type { SaveFlowInput, SaveFlowResult } from "./pin";

/**
 * Where a journey begins: a title and its first screen — two fields in the
 * panel, not a drawer. Everything after the first screen is composed on the
 * storyboard itself (click a control in a mirror, or the row's ghost card),
 * so this form deliberately knows nothing about steps, branches or specs.
 */
const FIELD =
	"mt-1 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-[13px] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100";
const LABEL = "text-[11px] font-medium uppercase tracking-wider text-zinc-400";
const ROUTES_LIST = "workbench-flow-start-routes";

export function FlowStart({
	routes,
	waiting,
	onSave,
	onCreated,
	onCancel,
	onReset,
}: {
	/** The app's page routes, offered as suggestions — not a constraint: a
	 *  journey is usually authored before its pages exist. */
	routes: string[];
	/** The flow id already created and not yet in the map, if any — the form
	 *  then shows the wait instead of the fields. */
	waiting: string | null;
	onSave: (input: SaveFlowInput) => Promise<SaveFlowResult>;
	onCreated: (flowId: string) => void;
	/** Absent when there is no board to go back to (a map with no flows). */
	onCancel?: () => void;
	/** Leaves the waiting state behind (clears the parent's created id) — the
	 *  exit when the rescan failed and the map will not arrive on its own. */
	onReset: () => void;
}) {
	const [title, setTitle] = useState("");
	const [route, setRoute] = useState("/");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [note, setNote] = useState<string | null>(null);

	const submit = async () => {
		if (busy || !title.trim() || !route.trim()) return;
		setBusy(true);
		setError(null);
		try {
			const saved = await onSave({
				id: null,
				title: title.trim(),
				description: "",
				intent: "",
				acceptance: "",
				steps: [{ route: route.trim() }],
				branches: [],
			});
			if (saved.ok && saved.flowId) {
				setNote(saved.note ?? null);
				onCreated(saved.flowId);
			} else {
				setError(saved.error ?? "Falló la escritura.");
				setBusy(false);
			}
		} catch (thrown) {
			// The production noop THROWS by design; a network blip rejects too.
			setError(thrown instanceof Error ? thrown.message : "Falló la escritura.");
			setBusy(false);
		}
	};

	return (
		<div className="flex h-full items-center justify-center p-10">
			<div className="w-80">
				<h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Añadir recorrido</h2>
				{waiting ? (
					<div className="mt-2 space-y-3">
						<p role="status" className="text-[12px] text-zinc-600 dark:text-zinc-300">
							{note ? (
								// The journey exists; only the map is stale — say exactly that.
								<>
									Recorrido «{waiting}» creado. {note}
								</>
							) : (
								<>Recorrido «{waiting}» creado — cargando el mapa…</>
							)}
						</p>
						{note && (
							// Without this, a first flow whose rescan failed was a dead
							// end: no rail entry to click, no button on this screen.
							<button
								type="button"
								onClick={() => {
									setNote(null);
									setBusy(false);
									onReset();
								}}
								className="rounded-md border border-zinc-300 px-3 py-1.5 text-[12px] text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
							>
								Volver
							</button>
						)}
					</div>
				) : (
					<form
						className="mt-3 space-y-3"
						onSubmit={(event) => {
							event.preventDefault();
							void submit();
						}}
						onKeyDown={(event) => {
							if (event.key === "Escape" && onCancel) {
								event.stopPropagation();
								onCancel();
							}
						}}
					>
						<p className="text-[11px] text-zinc-500 dark:text-zinc-400">
							Un título y su primera pantalla; el resto del recorrido se compone en el tablero,
							pantalla a pantalla.
						</p>
						<label className="block">
							<span className={LABEL}>Título</span>
							<input
								value={title}
								onChange={(event) => setTitle(event.target.value)}
								placeholder="Checkout por método"
								autoFocus
								className={FIELD}
							/>
						</label>
						<label className="block">
							<span className={LABEL}>Primera pantalla</span>
							<input
								value={route}
								onChange={(event) => setRoute(event.target.value)}
								list={ROUTES_LIST}
								placeholder="/"
								className={`${FIELD} font-mono`}
							/>
							<datalist id={ROUTES_LIST}>
								{routes.map((entry) => (
									<option key={entry} value={entry} />
								))}
							</datalist>
						</label>
						{error && (
							// The engine's sentence, verbatim.
							<p role="alert" className="text-[11px] text-red-700 dark:text-red-300">
								{error}
							</p>
						)}
						<div className="flex items-center gap-2">
							<button
								type="submit"
								disabled={busy || !title.trim() || !route.trim()}
								className="rounded-md bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
							>
								{busy ? "Creando…" : "Crear"}
							</button>
							{onCancel && (
								<button
									type="button"
									onClick={onCancel}
									className="rounded-md border border-zinc-300 px-3 py-1.5 text-[12px] text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
								>
									Cancelar
								</button>
							)}
						</div>
					</form>
				)}
			</div>
		</div>
	);
}
