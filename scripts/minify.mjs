#!/usr/bin/env node
/**
 * Minify the emitted JS in place, after tsc.
 *
 * The packages are PUBLIC on npm while the repository is private: the compiled
 * viewer is the one artifact that ships as JavaScript, so it goes out with no
 * comments, no maps and mangled locals. The `.d.ts` files are deliberately
 * untouched — the typed API is documentation for consumers, not engine IP.
 *
 * esbuild preserves leading directives, so every `"use client"` survives —
 * asserted by the tarball audit in the release gates, not assumed.
 */
import { build } from "esbuild";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");

const entries = readdirSync(dist, { recursive: true })
	.filter((name) => String(name).endsWith(".js"))
	.map((name) => join(dist, String(name)));

await build({
	entryPoints: entries,
	outdir: dist,
	allowOverwrite: true,
	minify: true,
	// Each module minifies alone; bundling would inline the lazy boundaries the
	// package exists to keep apart.
	bundle: false,
	format: "esm",
	target: "es2022",
});

console.log(`minify: ${entries.length} módulos`);
