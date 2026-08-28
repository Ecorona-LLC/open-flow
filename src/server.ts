import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { NewTicketInput, TicketSummary } from "./pin";

/**
 * Ticket persistence — plain server-side functions, deliberately **not** a
 * `"use server"` module.
 *
 * A Server Action has to be owned by the host app: it is the host's bundler
 * that registers it, and the host's `next.config` that decides what reaches
 * production. A directive inside `node_modules` asks the framework to register
 * an action from a package the host never wrote, which is both fragile and the
 * wrong place for that decision. The `./actions` export behind the
 * `development` condition is what the host mounts; that condition plus
 * `assertDev()` below is the security boundary.
 *
 * Both functions shell out to the same `workbench` binary the terminal uses. That
 * is deliberate: a ticket written from the UI and one written from the CLI go
 * through one writer, so the format cannot drift — the duplication this whole
 * tool exists to remove.
 *
 * SECURITY. A Server Action stays registered in the bundle even when its page
 * 404s, so a production deploy would still expose these entry points. Hence:
 *
 *  1. `assertDev()` — refuses unless NODE_ENV is exactly "development". An
 *     allow-list, not a denylist: `undefined`, `"test"` and `"staging"` all
 *     reached a file writer under the previous `!== "production"` check, and a
 *     preview filesystem is read-only anyway, so there is nothing to gain there
 *     and a writer to lose.
 *  2. Every string is capped before it reaches the binary.
 *  3. `execFile` (never `exec`) with an argv array — no shell, so a title can
 *     never become a command.
 */
const run = promisify(execFile);

const MAX_TITLE = 120;
const MAX_TEXT = 4000;
const MAX_PINS = 50;
/** A binary that hangs (a git lock, a dead disk) must not hang the action. */
const EXEC_TIMEOUT_MS = 30_000;
/** The Node default is 1 MB; a repo with a few hundred tickets exceeds it and
 *  the catch silently answered "no tickets" for a repo full of them. */
const EXEC_MAX_BUFFER = 16 * 1024 * 1024;

/** One definition, both callers: the allow-list is a security decision, and a
 *  future edit to it must not have to remember there are two copies. */
function isDev(): boolean {
	return process.env.NODE_ENV === "development";
}

function assertDev(): void {
	if (!isDev()) {
		throw new Error("El taller sólo escribe tickets en desarrollo.");
	}
}

function clamp(value: string | undefined, max: number): string {
	return (value ?? "").slice(0, max).trim();
}

/** The binary, as npm installed it. */
function binary(): string {
	return "workbench";
}

/** A type predicate rather than an assertion — the binary's stdout is input. */
function isCreated(value: unknown): value is { id: unknown; path: unknown } {
	return typeof value === "object" && value !== null && "id" in value && "path" in value;
}

export async function readTickets(): Promise<TicketSummary[]> {
	if (!isDev()) return [];
	try {
		const { stdout } = await run(binary(), ["tickets"], {
			cwd: process.cwd(),
			timeout: EXEC_TIMEOUT_MS,
			maxBuffer: EXEC_MAX_BUFFER,
		});
		const parsed: unknown = JSON.parse(stdout);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		// No binary, no tickets directory, no git — none of which should take the
		// panel down. An empty list reads correctly in all three cases.
		return [];
	}
}

export async function writeTicket(
	input: NewTicketInput,
): Promise<{ ok: boolean; id?: string; file?: string; prompt?: string; error?: string }> {
	assertDev();

	const title = clamp(input.title, MAX_TITLE);
	if (title.length === 0) return { ok: false, error: "Falta el título." };
	const surface = clamp(input.surface, 100);
	if (surface.length === 0) return { ok: false, error: "Falta la superficie." };

	const payload = JSON.stringify({
		intent: clamp(input.intent, MAX_TEXT),
		acceptance: clamp(input.acceptance, MAX_TEXT),
		route: clamp(input.route, 200),
		pins: (input.pins ?? []).slice(0, MAX_PINS).map((pin) => ({
			note: clamp(pin.note, 500),
			element: {
				tag: clamp(pin.element.tag, 40),
				classes: clamp(pin.element.classes, 300),
				text: clamp(pin.element.text, 120),
				path: clamp(pin.element.path, 300),
			},
			node: pin.node,
		})),
		errors: (input.errors ?? []).slice(0, 20).map((error) => ({
			message: clamp(error.message, 500),
			component: error.component,
			file: error.file,
			route: error.route,
		})),
	});

	try {
		const child = run(binary(), ["ticket", surface, title, "--json"], {
			cwd: process.cwd(),
			timeout: EXEC_TIMEOUT_MS,
			maxBuffer: EXEC_MAX_BUFFER,
		});
		// EPIPE from a binary that exits before reading stdin is an async
		// 'error' event; with no listener it is an uncaught exception the
		// surrounding try/catch never sees — it took the dev server down.
		child.child.stdin?.on("error", () => {});
		child.child.stdin?.end(payload);
		const { stdout } = await child;
		const created: unknown = JSON.parse(stdout.trim());
		if (!isCreated(created)) return { ok: true };

		const id = String(created.id);
		const file = String(created.path).replace(`${process.cwd()}/`, "");
		// The clipboard half of "write it and hand it over": a prompt that points
		// at the record rather than restating it, so the two cannot drift.
		const prompt =
			`Lee ${file} y ejecútalo. Es un ticket del taller contra la superficie ` +
			`"${surface}"; el mapa de archivos ya está dentro. Al terminar: commit con ` +
			`${id} en el mensaje, luego \`workbench validate ${id}\`.`;
		return { ok: true, id, file, prompt };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : "Falló la escritura.",
		};
	}
}
