"use client";

import { use, type ComponentType, type ReactNode } from "react";
import type { Demo, DemoModule } from "./demo";
import type { ComponentEntry, PropSpec, SampleValue } from "./manifest.types";

/**
 * The generated registry, as the host hands it in.
 *
 * `workbench scan` writes `.workbench/registry.ts` into the *host* repo, not
 * into this package — a lazy `import()` needs a static specifier the bundler
 * can see, and those specifiers point at the host's own files. So the host
 * passes the registry down and the package never guesses at paths.
 */
export interface RegistryEntry {
	id: string;
	load: () => Promise<Record<string, unknown>>;
	/** `undefined` for a default export. */
	exportName?: string;
	/** A hand-written demo module, when one exists. */
	demo?: () => Promise<{ default: unknown }>;
}

/** What a loaded entry can give the preview. */
export interface Loaded {
	Component: ComponentType<Record<string, unknown>> | null;
	demo: Demo | null;
	error: string | null;
}

/**
 * The promise cache is what makes `use()` safe here — a promise created during
 * render would be a new one on every pass and never settle. Module scope means
 * it also survives re-selection, so flipping between two components is instant
 * after the first load.
 */
const cache = new Map<string, Promise<Loaded>>();

function isComponent(value: unknown): value is ComponentType<Record<string, unknown>> {
	// A function, or a forwardRef/memo object. Anything else is a constant that
	// happened to be exported under a capitalised name.
	if (typeof value === "function") return true;
	return typeof value === "object" && value !== null && "$$typeof" in value;
}

function isDemo(value: unknown): value is Demo {
	return (
		typeof value === "object" &&
		value !== null &&
		"render" in value &&
		typeof Reflect.get(value, "render") === "function"
	);
}

async function loadEntry(entry: RegistryEntry): Promise<Loaded> {
	let demo: Demo | null = null;
	if (entry.demo) {
		const module: { default: unknown } = await entry.demo();
		if (isDemo(module.default)) demo = module.default;
	}

	const module = await entry.load();
	const exported = entry.exportName ? module[entry.exportName] : module["default"];
	if (!isComponent(exported)) {
		return {
			Component: null,
			demo,
			error: entry.exportName
				? `El módulo no exporta un componente llamado ${entry.exportName}.`
				: "El módulo no tiene una exportación por defecto que sea un componente.",
		};
	}
	return { Component: exported, demo, error: null };
}

export function useComponentModule(entry: RegistryEntry): Loaded {
	let promise = cache.get(entry.id);
	if (!promise) {
		promise = loadEntry(entry);
		// Evict a rejection, or a component that fails to compile once would
		// keep replaying the same error after you fixed the file, until a
		// reload. `catch` on a detached copy: the cached promise must stay
		// rejected so `use()` still throws into the error boundary this pass.
		promise.catch(() => cache.delete(entry.id));
		cache.set(entry.id, promise);
	}
	return use(promise);
}

/**
 * The props a synthesized render passes.
 *
 * `node` samples become children rather than a prop value, because that is what
 * a `ReactNode` prop is for and a string passed as `children` renders as text
 * either way.
 */
/**
 * Shared, so a re-render does not hand a component a new function identity every
 * pass — which would defeat memoisation in the very components most likely to
 * be memoised.
 */
const NOOP = () => {};

export function sampleProps(specs: PropSpec[]): {
	props: Record<string, unknown>;
	children: ReactNode;
} {
	const props: Record<string, unknown> = {};
	let children: ReactNode = null;

	for (const spec of specs) {
		if (!spec.sample) continue;

		// A callback carries no value — the scanner cannot put a function in
		// JSON, so it says `callback` and the function is made here.
		if (spec.sample.kind === "callback") {
			props[spec.name] = NOOP;
			continue;
		}

		const value: SampleValue = spec.sample.value;
		if (spec.name === "children") {
			// An array of nodes is legal children; a boolean is not renderable.
			children = typeof value === "boolean" ? String(value) : value;
			continue;
		}
		props[spec.name] = value;
	}
	return { props, children };
}

/** Index the registry by component id, so a panel selection is a lookup. */
export function indexRegistry(registry: RegistryEntry[]): Map<string, RegistryEntry> {
	return new Map(registry.map((entry) => [entry.id, entry]));
}

export type { Demo, DemoModule };
export type { ComponentEntry };
