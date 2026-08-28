"use client";

import { useCallback, useEffect, useState } from "react";
import { isElement, readProp } from "./dom-realm";
import { PickHighlight, type PickTarget } from "./pick-highlight";
import type { Pin, RuntimeError } from "./pin";
import { subscribeRuntimeErrors } from "./runtime-errors";

/**
 * The state a picking session holds, in one place.
 *
 * Shared by the workbench shell and the isolated single-screen viewer so the
 * two cannot drift into different pick behaviours — the second one existing at
 * all is why this is a hook and not state inside the app component.
 */
export interface EditSession {
	editing: boolean;
	toggleEditing: () => void;
	pins: Pin[];
	addPin: (pin: Pick<Pin, "element" | "node">) => void;
	updatePin: (index: number, note: string) => void;
	removePin: (index: number) => void;
	clearPins: () => void;
	hovering: PickTarget | null;
	setHovering: (target: PickTarget | null) => void;
	errors: RuntimeError[];
	drawerOpen: boolean;
	openDrawer: () => void;
	closeDrawer: () => void;
}

export function useEditSession(options?: {
	/**
	 * Bind bare `e`/`n` on the window. Only the workbench's own screens pass
	 * true: the overlay runs on every real page, where a bare letter belongs
	 * to the app — the same reasoning that made the overlay's toggle ⌥P and
	 * not `p`. Escape stays bound everywhere; disarming is never a hijack.
	 */
	bareKeys?: boolean;
}): EditSession {
	const bareKeys = options?.bareKeys ?? false;
	const [editing, setEditing] = useState(false);
	const [pins, setPins] = useState<Pin[]>([]);
	const [hovering, setHovering] = useState<PickTarget | null>(null);
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [errors, setErrors] = useState<RuntimeError[]>([]);

	useEffect(() => subscribeRuntimeErrors(setErrors), []);

	const addPin = useCallback((pin: Pick<Pin, "element" | "node">) => {
		// A pin starts noteless; the drawer is where you say what should change.
		// Opening the drawer on the first pin means one click gets you from
		// "that thing" to a form, which is the whole point of picking.
		setPins((current) => [...current, { ...pin, note: "" }]);
		setDrawerOpen(true);
	}, []);

	const toggleEditing = useCallback(() => {
		setEditing((current) => {
			if (current) setHovering(null);
			return !current;
		});
	}, []);

	// `E` arms picking, Escape disarms it — but never while you are typing into
	// the drawer, or the note would lose its letters to the shortcut.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			// Realm-agnostic, like every other DOM check in this package —
			// `instanceof HTMLElement` is the exact bug dom-realm.ts exists for.
			const target = event.target;
			const typing =
				isElement(target) &&
				(readProp(target, "isContentEditable") === true ||
					["INPUT", "TEXTAREA", "SELECT"].includes(String(readProp(target, "tagName"))));
			if (typing) return;

			if (bareKeys && (event.key === "e" || event.key === "E")) {
				event.preventDefault();
				toggleEditing();
			}
			if (event.key === "Escape") {
				setEditing(false);
				setHovering(null);
			}
			if (bareKeys && (event.key === "n" || event.key === "N")) {
				event.preventDefault();
				setDrawerOpen(true);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [toggleEditing, bareKeys]);

	return {
		editing,
		toggleEditing,
		pins,
		addPin,
		updatePin: useCallback((index, note) => {
			setPins((current) =>
				current.map((pin, position) => (position === index ? { ...pin, note } : pin)),
			);
		}, []),
		removePin: useCallback((index) => {
			setPins((current) => current.filter((_, position) => position !== index));
		}, []),
		clearPins: useCallback(() => setPins([]), []),
		hovering,
		setHovering,
		errors,
		drawerOpen,
		openDrawer: useCallback(() => setDrawerOpen(true), []),
		closeDrawer: useCallback(() => setDrawerOpen(false), []),
	};
}

/** The outline that follows the cursor. Rendered wherever picking is armed. */
export function EditSessionOverlay({ session }: { session: EditSession }) {
	if (!session.editing) return null;
	return <PickHighlight target={session.hovering} />;
}
