"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Manifest, ViewerConfig } from "./manifest.types";

/**
 * The manifest, once, for the whole viewer.
 *
 * The previous design imported a module-level `config` singleton, which works
 * inside one app and cannot work in a package: the config belongs to the *host*
 * repo, and the package is compiled once for all of them. A context also means
 * the isolated single-screen page and the main app read the same object rather
 * than each loading their own copy.
 */
const ManifestContext = createContext<Manifest | null>(null);

export function ManifestProvider({
	manifest,
	children,
}: {
	manifest: Manifest;
	children: ReactNode;
}) {
	return <ManifestContext.Provider value={manifest}>{children}</ManifestContext.Provider>;
}

/**
 * Throws rather than returning null. Every consumer is rendered inside the
 * provider by construction, and an optional manifest would put a `?.` on every
 * read for a case that cannot happen.
 */
export function useManifest(): Manifest {
	const manifest = useContext(ManifestContext);
	if (!manifest) {
		throw new Error("Falta <ManifestProvider>: el visor necesita un manifiesto.");
	}
	return manifest;
}

export function useViewerConfig(): ViewerConfig {
	return useManifest().config;
}
