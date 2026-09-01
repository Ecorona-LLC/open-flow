"use client";

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { cx } from "./cx";
import { useFloating } from "./floating";
import { EN_CURSO } from "./journey-acts";
import type { NodeAction } from "./node-actions";

/**
 * A screen's own actions, at the pointer.
 *
 * The chips under a screen are `NearOnly` — at a far zoom they are hidden,
 * which is correct (constant-size chrome under twenty screens is the clutter
 * round three removed) and leaves the screen with no controls at all. This is
 * the same actions, summoned where you are pointing, so a far view is
 * navigable rather than merely readable.
 *
 * It renders `nodeActions`' list verbatim: same order, same words, same
 * blocked reasons. Nothing here decides what a screen can do.
 */
export function NodeMenu({
	title,
	at,
	actions,
	note,
	busy,
	onRun,
	onClose,
}: {
	/** The screen this belongs to, so the menu is not anonymous. */
	title: string;
	/** Where the pointer was, in viewport coordinates. */
	at: { top: number; left: number };
	actions: readonly NodeAction[];
	/** Why the journey allows nothing more here. Shown verbatim, the way the
	 *  popover shows it over a control. */
	note: string | null;
	/** A write is in flight, or a card is open: the editing actions wait. */
	busy: boolean;
	onRun: (action: NodeAction) => void;
	onClose: () => void;
}) {
	const first = useRef<HTMLButtonElement>(null);
	/** Arrow-key traversal, because `role="menu"` promises it: a screen reader
	 *  puts the user in application mode, where Tab is not the expected
	 *  gesture. Read from the DOM rather than tracked in state — the rows are
	 *  the truth, and one of them can be blocked. */
	const move = (event: ReactKeyboardEvent<HTMLDivElement>, step: number | "first" | "last") => {
		const rows = Array.from(
			ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
		);
		if (rows.length === 0) return;
		event.preventDefault();
		const here = rows.findIndex((row) => row === document.activeElement);
		const next =
			step === "first"
				? 0
				: step === "last"
					? rows.length - 1
					: (here + step + rows.length) % rows.length;
		rows[next]?.focus();
	};
	// A pointer is a point; `useFloating` places below a box, and a zero-sized
	// one puts the menu exactly at the cursor.
	const anchor = { top: at.top, left: at.left, width: 0, height: 0 };
	const { ref, placed, style } = useFloating(anchor, onClose);

	// The container falls back for itself when there is no row: without it
	// nothing is focusable, and Escape — which rides React's synthetic bubbling
	// from a row — has nothing to bubble from, so an empty menu could only be
	// dismissed with the mouse.
	useEffect(() => {
		if (placed) (first.current ?? ref.current)?.focus();
	}, [placed]);

	return (
		<div
			ref={ref}
			role="menu"
			tabIndex={-1}
			aria-label={`Acciones de ${title}`}
			onKeyDown={(event) => {
				if (event.key === "Escape") onClose();
				else if (event.key === "ArrowDown") move(event, 1);
				else if (event.key === "ArrowUp") move(event, -1);
				else if (event.key === "Home") move(event, "first");
				else if (event.key === "End") move(event, "last");
			}}
			className="fixed z-[2147483050] w-52 rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
			style={placed ? style : { ...style, visibility: "hidden" }}
		>
			<p
				// `role="menu"` admits only menuitem/group/separator children, and
				// several screen readers drop the rest — including the note this
				// round went to trouble to match to the popover's sentence.
				role="presentation"
				className="truncate px-1.5 pt-1 pb-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400"
			>
				{title}
			</p>
			{actions.length === 0 ? (
				<p role="presentation" className="px-1.5 pb-1 text-[11px] text-zinc-500 dark:text-zinc-400">
					Nada que hacer aquí todavía.
				</p>
			) : (
				actions.map((action, index) => {
					const waiting = action.edits && busy;
					// A blocked action keeps its row and its reason. `aria-disabled`
					// rather than `disabled`, as the chips already do: the SENTENCE
					// is the point, and a tooltip on an unfocusable control reaches
					// nobody.
					const off = action.blocked !== null || waiting;
					return (
						<button
							key={action.id}
							ref={index === 0 ? first : undefined}
							type="button"
							role="menuitem"
							aria-disabled={off || undefined}
							// A `blocked` row carries its reason in a child span, so it
							// is already part of the accessible name; a `waiting` one
							// has only the tooltip, which is read inconsistently.
							aria-label={waiting ? `${action.label} — ${EN_CURSO}` : undefined}
							title={waiting ? EN_CURSO : action.title}
							onClick={() => {
								if (off) return;
								onRun(action);
							}}
							className={cx(
								"block w-full rounded px-1.5 py-1 text-left text-[12px] text-zinc-700 dark:text-zinc-200",
								off ? "opacity-40" : "hover:bg-zinc-100 dark:hover:bg-zinc-800",
							)}
						>
							{action.label}
							{action.blocked && (
								<span className="mt-0.5 block text-[10px] leading-snug text-amber-700 dark:text-amber-300">
									{action.blocked}
								</span>
							)}
						</button>
					);
				})
			)}
			{note && (
				<p
					role="presentation"
					className="px-1.5 pt-1 pb-0.5 text-[10px] leading-snug text-zinc-500 dark:text-zinc-400"
				>
					{note}
				</p>
			)}
		</div>
	);
}
