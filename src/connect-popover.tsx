"use client";

import { useEffect, useRef } from "react";
import { cx } from "./cx";
import { useFloating } from "./floating";
import type { ConnectAction, ConnectIntent } from "./flow-edit";
import type { MirrorPick } from "./frame";
import { CHIP } from "./screen-toolbar";

/**
 * The offer a clicked control makes: «Empezar» → /registro · + Añadir
 * pantalla. Non-modal and easily lost on purpose — `useFloating` places it and
 * dismisses it the moment the world it points at moves.
 *
 * It renders an intent and decides nothing: which actions exist here is
 * `connectIntent`'s answer, and this component used to hold a second copy of
 * that rule in its per-mode copy, which is how the two drifted.
 */

export function ConnectPopover({
	pick,
	route,
	intent,
	onConfirm,
	onCancel,
}: {
	pick: MirrorPick;
	/** The control's destination as a route of this app, when it has one. */
	route: string | null;
	/** What can be done here — decided once, in `flow-edit.ts`, and merely
	 *  rendered here. This component used to hold a second copy of that rule
	 *  in its per-mode copy, which is how the two drifted. */
	intent: ConnectIntent;
	onConfirm: (action: ConnectAction) => void;
	onCancel: () => void;
}) {
	const primary = intent.actions[0] ?? null;
	const alternate = intent.actions[1] ?? null;
	const primaryRef = useRef<HTMLButtonElement>(null);
	const cancelRef = useRef<HTMLButtonElement>(null);
	const { ref, placed, style } = useFloating(pick.rect, onCancel, intent);

	// Focus only once the popover is visible: a `visibility: hidden` element
	// refuses focus, so focusing in the measuring pass left focus in the
	// iframe and Escape talking to the wrong document.
	useEffect(() => {
		if (placed) (primary ? primaryRef.current : cancelRef.current)?.focus();
	}, [placed, primary]);

	return (
		<div
			ref={ref}
			role="dialog"
			aria-label={`Conectar «${pick.text || "control"}»`}
			onKeyDown={(event) => {
				if (event.key === "Escape") onCancel();
			}}
			className="fixed z-[2147483050] w-72 rounded-md border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
			style={placed ? style : { ...style, visibility: "hidden" }}
		>
			<p className="truncate text-[12px] font-medium text-zinc-900 dark:text-zinc-100">
				«{pick.text || "sin texto"}»
				{route && (
					<span className="ml-1 font-mono text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
						→ {route}
					</span>
				)}
			</p>
			<p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
				{primary ? primary.hint : "No se puede añadir desde aquí."}
				{!route &&
					primary &&
					" · el control no lleva a una ruta de esta app, escríbela en la tarjeta"}
			</p>
			{intent.existing && (
				// Said, not acted on: a flow is a trunk and its branches, with no
				// way to express "and this one rejoins there". Better to report a
				// fact the schema holds than to offer a graph it cannot.
				<p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">
					Esa pantalla ya está en el recorrido (paso {intent.existing.number}).
				</p>
			)}
			{intent.note && (
				<p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">{intent.note}</p>
			)}
			<div className="mt-2 flex items-center gap-2">
				{primary && (
					<button
						ref={primaryRef}
						type="button"
						onClick={() => onConfirm(primary)}
						className="shrink-0 whitespace-nowrap rounded-md bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
					>
						+ {primary.button}
					</button>
				)}
				{alternate && (
					<button
						type="button"
						onClick={() => onConfirm(alternate)}
						className="shrink-0 whitespace-nowrap rounded px-1 text-[11px] font-medium text-sky-700 underline decoration-dotted underline-offset-2 hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-100"
						title={alternate.hint}
					>
						¿{alternate.verb}?
					</button>
				)}
				<button ref={cancelRef} type="button" onClick={onCancel} className={cx(CHIP)}>
					Cancelar
				</button>
			</div>
		</div>
	);
}
