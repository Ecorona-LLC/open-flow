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
	// NOT the default `browser`: with minify on, esbuild then defines
	// `process.env.NODE_ENV` as "production" at build time, and `server.ts`'s
	// `isDev()` shipped as `return false` — from 0.2.0 on, the published viewer
	// refused every ticket and journey written from the UI, in development too.
	// The modules are ESM for both runtimes and nothing here bundles, so
	// `neutral` changes nothing else. Asserted by `verify-dist.mjs` below.
	platform: "neutral",
});

console.log(`minify: ${entries.length} módulos`);

// Run from here rather than from package.json so the check travels with the
// script: the public repo builds with this file but owns its own package.json.
await import("./verify-dist.mjs");
