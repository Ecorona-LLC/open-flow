"use client";

import type { RuntimeError } from "./pin";

/**
 * Runtime errors seen while the workbench is open — the "where did it crash"
 * half of a ticket.
 *
 * Deliberately in-memory and unpersisted: this is a workbench, not a monitoring
 * product, and whatever the host uses in production already owns error
 * tracking. An entry matters only long enough to be attached to a ticket you
 * are writing right now.
 *
 * A tiny store rather than React state because the reporters are outside the
 * React tree — an error boundary's `componentDidCatch`, and `error` listeners
 * inside a flow iframe's document.
 */
const MAX_ENTRIES = 20;

let entries: RuntimeError[] = [];
const listeners = new Set<(entries: RuntimeError[]) => void>();

function emit() {
	for (const listener of listeners) listener(entries);
}

export function reportRuntimeError(entry: Omit<RuntimeError, "at">): void {
	const next: RuntimeError = { ...entry, at: new Date().toISOString() };
	// The same message from the same place twice running is one fault, not two —
	// a render loop would otherwise fill the list in a second.
	const previous = entries[0];
	if (previous && previous.message === next.message && previous.file === next.file) return;
	entries = [next, ...entries].slice(0, MAX_ENTRIES);
	emit();
}

export function subscribeRuntimeErrors(listener: (entries: RuntimeError[]) => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
