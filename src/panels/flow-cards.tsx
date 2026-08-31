"use client";

import { type ReactNode } from "react";
import { cx } from "../cx";
import type { FlowStep, Viewport } from "../manifest.types";
import { framedWidth } from "../screen-frame";

/**
 * The storyboard's non-frame columns: what a step shows when it is not a
 * page, and what the composer draws while a new screen is being authored.
 * Everything here renders at a viewport's NATURAL size and is scaled down by
 * the board, so the type is set huge to survive that.
 */

/**
 * The natural-size box a step shows when it is not a frame. A dark island of
 * its own, because it renders in THIS document: a `dark:` variant here
 * follows the workbench's theme, not the board's, and in split mode the dark
 * board's cards painted light.
 */
export function Stage({
	viewport,
	theme,
	className,
	children,
}: {
	viewport: Viewport;
	theme: "light" | "dark";
	className?: string;
	children: ReactNode;
}) {
	return (
		<div
			className={cx(theme === "dark" && "dark", "bg-zinc-50 dark:bg-zinc-900", className)}
			style={{ width: viewport.width, height: viewport.height }}
		>
			{children}
		</div>
	);
}

/** The card a step shows while its page does not exist yet. */
export function SpecCard({
	step,
	viewport,
	theme,
}: {
	step: FlowStep;
	viewport: Viewport;
	theme: "light" | "dark";
}) {
	return (
		<Stage
			viewport={viewport}
			theme={theme}
			className="flex flex-col gap-6 p-12 text-zinc-700 dark:text-zinc-200"
		>
			{/* Wraps: on a 390px card the chip and a route like `/panel/pro`
			    already exceed the content width, and a route has no break
			    opportunity of its own. */}
			<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
				<span className="rounded-md border border-dashed border-amber-500 px-3 py-1 text-xl font-medium uppercase tracking-wider text-amber-700 dark:text-amber-300">
					Por construir
				</span>
				<span className="break-all font-mono text-2xl text-zinc-500 dark:text-zinc-400">
					{step.route}
				</span>
			</div>
			<h3 className="text-5xl font-semibold leading-tight text-zinc-900 dark:text-zinc-100">
				{step.label}
			</h3>
			<p className="max-w-3xl text-3xl leading-relaxed">
				{step.spec ??
					"Sin especificación todavía. Añádela con la tarjeta al crear la pantalla, o con `spec` en workbench.config.json, para que este cuadro diga qué debe hacer la pantalla."}
			</p>
		</Stage>
	);
}

/** What the composer's card is editing. */
export interface CardDraft {
	route: string;
	label: string;
	spec: string;
	/** The control that led here, when the card came from a mirror click. */
	via: string;
	/** Only read while forking. */
	branchLabel: string;
}

export type CardStatus =
	| "editing"
	| "writing"
	| { error: string }
	/** Written; `note` when the rescan failed, else waiting for the map. */
	| { written: string | null };

const CARD_FIELD =
	"mt-2 w-full rounded-md border border-zinc-300 bg-white px-4 py-3 text-3xl text-zinc-900 disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100";
const CARD_LABEL = "text-2xl font-medium uppercase tracking-wider text-zinc-400";

/**
 * The card a new screen is authored in — a real column on the board, where
 * the screen will appear, not a drawer beside it. Nearly no validation on
 * purpose: a route is enough to send, and the engine's refusal is shown
 * verbatim rather than rephrased into a second rulebook.
 */
export function NewScreenCard({
	viewport,
	theme,
	fork,
	routesList,
	draft,
	status,
	onDraft,
	onSubmit,
	onCancel,
}: {
	viewport: Viewport;
	theme: "light" | "dark";
	fork: boolean;
	/** Id of the datalist with the app's page routes (the panel renders it once). */
	routesList: string;
	draft: CardDraft;
	status: CardStatus;
	onDraft: (changes: Partial<CardDraft>) => void;
	onSubmit: () => void;
	onCancel: () => void;
}) {
	const written = typeof status === "object" && "written" in status;
	const busy = status === "writing" || written;
	const sendable = draft.route.trim().length > 0 && (!fork || draft.branchLabel.trim().length > 0);
	return (
		<Stage
			viewport={viewport}
			theme={theme}
			className="flex flex-col gap-6 overflow-hidden p-12 text-zinc-700 dark:text-zinc-200"
		>
			<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
				<span className="rounded-md border border-dashed border-sky-500 px-3 py-1 text-xl font-medium uppercase tracking-wider text-sky-700 dark:text-sky-300">
					{fork ? "Nueva rama" : "Nueva pantalla"}
				</span>
				{draft.via.trim() && (
					<span className="text-2xl text-zinc-500 dark:text-zinc-400">
						vía «{draft.via.trim()}»
					</span>
				)}
			</div>
			<form
				className="flex min-h-0 flex-1 flex-col gap-5"
				onSubmit={(event) => {
					event.preventDefault();
					onSubmit();
				}}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						// Kept from the session's global handler, whose Escape would
						// also drop edit mode.
						event.stopPropagation();
						onCancel();
					}
				}}
			>
				{fork && (
					<label className="block">
						<span className={CARD_LABEL}>Nombre de la rama</span>
						<input
							value={draft.branchLabel}
							onChange={(event) => onDraft({ branchLabel: event.target.value })}
							placeholder="Tier 2"
							disabled={busy}
							className={CARD_FIELD}
						/>
					</label>
				)}
				<label className="block">
					<span className={CARD_LABEL}>Ruta</span>
					<input
						value={draft.route}
						onChange={(event) => onDraft({ route: event.target.value })}
						list={routesList}
						placeholder="/pantalla"
						autoFocus
						disabled={busy}
						className={cx(CARD_FIELD, "font-mono")}
					/>
				</label>
				<label className="block">
					<span className={CARD_LABEL}>Nombre</span>
					<input
						value={draft.label}
						onChange={(event) => onDraft({ label: event.target.value })}
						placeholder="Qué pantalla es"
						disabled={busy}
						className={CARD_FIELD}
					/>
				</label>
				<label className="block">
					<span className={CARD_LABEL}>Qué debe hacer</span>
					<textarea
						value={draft.spec}
						onChange={(event) => onDraft({ spec: event.target.value })}
						rows={4}
						placeholder="Se muestra en el tablero mientras la página no exista."
						disabled={busy}
						className={cx(CARD_FIELD, "resize-none")}
					/>
				</label>
				{typeof status === "object" && "error" in status && (
					// The engine's sentence, verbatim; the inputs stay as typed.
					<p role="alert" className="text-2xl leading-snug text-red-700 dark:text-red-300">
						{status.error}
					</p>
				)}
				{written && (
					<p role="status" className="text-2xl text-emerald-700 dark:text-emerald-300">
						{status.written ?? "Escrito · esperando el mapa…"}
					</p>
				)}
				<div className="mt-auto flex items-center gap-4">
					<button
						type="submit"
						disabled={busy || !sendable}
						className="rounded-md bg-zinc-900 px-6 py-3 text-2xl font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
					>
						{status === "writing" ? "Escribiendo…" : "Añadir"}
					</button>
					<button
						type="button"
						onClick={onCancel}
						disabled={status === "writing"}
						className="rounded-md border border-zinc-300 px-6 py-3 text-2xl text-zinc-700 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-200"
					>
						{written ? "Cerrar" : "Cancelar"}
					</button>
				</div>
			</form>
		</Stage>
	);
}

/** The split twin of an open card: same size, no second set of live inputs —
 *  two fields bound to one draft fight over focus and `autoFocus`. */
export function TailPlaceholder({
	viewport,
	theme,
	writing,
}: {
	viewport: Viewport;
	theme: "light" | "dark";
	writing: boolean;
}) {
	return (
		<Stage viewport={viewport} theme={theme} className="flex items-center justify-center">
			<p className="max-w-lg px-10 text-center text-2xl leading-relaxed text-zinc-400 dark:text-zinc-500">
				{writing ? "Escribiendo…" : "Pantalla nueva — se edita en el tablero claro."}
			</p>
		</Stage>
	);
}

/** A ghost column's natural width. Narrower than a desktop viewport on
 *  purpose: at `fit`, a full-width ghost on every row costs real scale. */
export const GHOST_WIDTH = 390;

/**
 * The dashed "+ Añadir pantalla" that ends every row: a button the size of
 * the column the new screen would take, drawn in the parent document (no
 * transform — plain text reads at any board scale).
 */
export function GhostCard({
	width,
	height,
	scale,
	label,
	disabled,
	onOpen,
}: {
	width: number;
	height: number;
	scale: number;
	label: string;
	disabled: boolean;
	onOpen: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onOpen}
			disabled={disabled}
			className="flex shrink-0 items-center justify-center rounded-md border-2 border-dashed border-zinc-300 text-zinc-400 hover:border-sky-400 hover:text-sky-600 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-500 dark:hover:border-sky-500 dark:hover:text-sky-400"
			// The height floors inline: `framedWidth(height, …)` worked only
			// because the function is `floor(n·s)`, and a name that lies about
			// its axis invites the next wrong call.
			style={{ width: framedWidth(width, scale), height: Math.floor(height * scale) }}
		>
			<span className="px-2 text-center text-sm font-medium">{label}</span>
		</button>
	);
}
