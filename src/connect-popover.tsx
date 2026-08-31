"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cx } from "./cx";
import type { MirrorPick } from "./frame";
import { CHIP } from "./screen-toolbar";

/**
 * The offer a clicked control makes: «Empezar» → /registro · + Añadir
 * pantalla. Non-modal and easily lost on purpose — the world moving under a
 * `position: fixed` box leaves it anchored to nothing, so any scroll, resize,
 * outside click or focus change into an iframe closes it.
 */
export type PopoverMode = "append" | "fork" | "blocked";

/**
 * Below the control; flipped above when it would leave the viewport; clamped
 * horizontally. Pure, so the flip-and-clamp arithmetic has a test.
 */
export function placePopover(
	anchor: { top: number; left: number; width: number; height: number },
	size: { width: number; height: number },
	viewport: { width: number; height: number },
): { top: number; left: number } {
	const margin = 8;
	let top = anchor.top + anchor.height + 6;
	if (top + size.height > viewport.height - margin) {
		top = Math.max(margin, anchor.top - size.height - 6);
	}
	const left = Math.min(
		Math.max(anchor.left, margin),
		Math.max(margin, viewport.width - size.width - margin),
	);
	return { top, left };
}

function description(mode: PopoverMode, route: string | null): string {
	if (mode === "blocked") {
		return "Una rama sólo sale del tronco; añade al final de esta fila con «+ Añadir pantalla».";
	}
	if (mode === "fork") {
		return "Este paso ya tiene una pantalla siguiente; la nueva empieza una rama.";
	}
	return route
		? "La nueva pantalla sigue a esta."
		: "El control no lleva a una ruta de esta app; escribe la ruta en la tarjeta.";
}

export function ConnectPopover({
	pick,
	route,
	mode,
	onConfirm,
	onCancel,
}: {
	pick: MirrorPick;
	/** The control's destination as a route of this app, when it has one. */
	route: string | null;
	mode: PopoverMode;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const primaryRef = useRef<HTMLButtonElement>(null);
	const cancelRef = useRef<HTMLButtonElement>(null);
	const [at, setAt] = useState<{ top: number; left: number } | null>(null);
	const close = useRef(onCancel);
	useEffect(() => {
		close.current = onCancel;
	}, [onCancel]);

	// Measured once, then placed — starting hidden, so there is no flash at
	// (0,0) on the first paint.
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		setAt(
			placePopover(
				pick.rect,
				{ width: element.offsetWidth, height: element.offsetHeight },
				{ width: window.innerWidth, height: window.innerHeight },
			),
		);
	}, [pick, mode]);

	// Focus only once the popover is visible: a `visibility: hidden` element
	// refuses focus, so focusing in the measuring pass left focus in the
	// iframe and Escape talking to the wrong document.
	useEffect(() => {
		if (at) (mode === "blocked" ? cancelRef.current : primaryRef.current)?.focus();
	}, [at, mode]);

	useEffect(() => {
		const away = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node) || !ref.current?.contains(target)) close.current();
		};
		const gone = () => close.current();
		document.addEventListener("pointerdown", away, true);
		// A focus change into ANY iframe — another mirror, the live frame —
		// blurs the parent window; that is the only way the parent hears it.
		window.addEventListener("blur", gone);
		// Capture phase: the board's own `overflow-auto` container is what
		// scrolls, and its scroll does not bubble.
		window.addEventListener("scroll", gone, true);
		window.addEventListener("resize", gone);
		return () => {
			document.removeEventListener("pointerdown", away, true);
			window.removeEventListener("blur", gone);
			window.removeEventListener("scroll", gone, true);
			window.removeEventListener("resize", gone);
		};
	}, []);

	return (
		<div
			ref={ref}
			role="dialog"
			aria-label={`Conectar «${pick.text || "control"}»`}
			onKeyDown={(event) => {
				if (event.key === "Escape") onCancel();
			}}
			className="fixed z-[2147483050] w-64 rounded-md border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
			style={at ? { top: at.top, left: at.left } : { top: 0, left: 0, visibility: "hidden" }}
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
				{description(mode, route)}
			</p>
			<div className="mt-2 flex items-center gap-2">
				{mode !== "blocked" && (
					<button
						ref={primaryRef}
						type="button"
						onClick={onConfirm}
						className="rounded-md bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
					>
						{mode === "fork" ? "+ Añadir rama desde aquí" : "+ Añadir pantalla"}
					</button>
				)}
				<button ref={cancelRef} type="button" onClick={onCancel} className={cx(CHIP)}>
					Cancelar
				</button>
			</div>
		</div>
	);
}
