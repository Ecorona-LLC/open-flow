#!/usr/bin/env node
/**
 * What the minified `dist/` must still say, checked after every build.
 *
 * Two things esbuild can quietly take away, both of which decide whether the
 * package works at all:
 *
 *  - The `"use client"` / `"use server"` directives. Every module that carries
 *    one in `src/` must still start with it in `dist/`; a lost `"use client"`
 *    fails the host's build, a lost `"use server"` unregisters the actions.
 *  - `process.env.NODE_ENV` in `server.js`. The dev gate is the host's to
 *    decide at run time; folded at build time it became `isDev() { return
 *    false }` and every write from the UI was refused, in development too,
 *    for two published versions before anyone pressed the button.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../src");
const dist = resolve(here, "../dist");

const failures = [];
const directive = /^\s*"use (client|server)";/;

for (const name of readdirSync(src, { recursive: true })) {
	const file = String(name);
	if (!/\.tsx?$/.test(file) || file.endsWith(".test.ts")) continue;
	const match = directive.exec(readFileSync(join(src, file), "utf8"));
	if (!match) continue;
	const built = join(dist, file.replace(/\.tsx?$/, ".js"));
	let output;
	try {
		output = readFileSync(built, "utf8");
	} catch {
		failures.push(`${relative(dist, built)}: no existe en dist`);
		continue;
	}
	if (!output.startsWith(`"use ${match[1]}";`)) {
		failures.push(`${relative(dist, built)}: perdió su directiva "use ${match[1]}"`);
	}
}

const server = readFileSync(join(dist, "server.js"), "utf8");
if (!server.includes("process.env.NODE_ENV")) {
	failures.push(
		"server.js: `process.env.NODE_ENV` se resolvió al construir; `isDev()` quedó constante",
	);
}

if (failures.length > 0) {
	console.error(`verify-dist:\n  ${failures.join("\n  ")}`);
	process.exit(1);
}
console.log("verify-dist: directivas y NODE_ENV intactos");
