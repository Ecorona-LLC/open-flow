import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
	FlowStepInput,
	NewTicketInput,
	SaveFlowInput,
	SaveFlowResult,
	TicketSummary,
} from "./pin";

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
		throw new Error("El taller sólo escribe en desarrollo.");
	}
}

function clamp(value: string | undefined, max: number): string {
	// By code points, never UTF-16 units: slicing a surrogate pair in half
	// made `JSON.stringify` emit a lone surrogate that serde refuses, and the
	// whole write failed for a legal-looking input.
	return [...(value ?? "").trim()].slice(0, max).join("");
}

/** The binary, as npm installed it. */
function binary(): string {
	return "workbench";
}

/** A type predicate rather than an assertion — the binary's stdout is input. */
function isCreated(value: unknown): value is { id: unknown; path: unknown } {
	return typeof value === "object" && value !== null && "id" in value && "path" in value;
}

/**
 * What to show when the binary says no. Its refusal is on stderr, in the
 * sentence the terminal prints ("la rama 1 sale de "/x", y esa ruta no es un
 * paso del tronco"); `execFile`'s own message wraps it in "Command failed:
 * workbench …", which is the part nobody in a card needs.
 */
function failure(error: unknown): string {
	if (typeof error === "object" && error !== null && "stderr" in error) {
		const stderr = String(error.stderr).trim();
		const last = stderr.split("\n").filter(Boolean).at(-1);
		if (last) return last.replace(/^(error|Error):\s*/, "");
	}
	return error instanceof Error ? error.message : "Falló la escritura.";
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
	// Through the same queue as the flows: `next_id` is a read of the tickets
	// directory, and a ticket and a gesture landing together minted one T-id
	// twice.
	return enqueue(() => writeTicketBody(input));
}

async function writeTicketBody(
	input: NewTicketInput,
): Promise<{ ok: boolean; id?: string; file?: string; prompt?: string; error?: string }> {
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
		// Already root-relative: `render_flow_ticket` and the ticket writer
		// both answer `docs/tickets/…`.
		const file = String(created.path);
		// The clipboard half of "write it and hand it over": a prompt that points
		// at the record rather than restating it, so the two cannot drift.
		const prompt =
			`Lee ${file} y ejecútalo. Es un ticket del taller contra la superficie ` +
			`"${surface}"; el mapa de archivos ya está dentro. Al terminar: commit con ` +
			`${id} en el mensaje, luego \`workbench validate ${id}\`.`;
		return { ok: true, id, file, prompt };
	} catch (error) {
		return { ok: false, error: failure(error) };
	}
}

/** The engine caps a journey at 12 screens, trunk and branches together —
 *  `flows::MAX_STEPS`, restated. Refused here, never sliced: a shim that
 *  trimmed the 13th screen sent the engine a valid no-op, answered ok, and
 *  left the card waiting forever for a step that was silently dropped. */
const MAX_FLOW_STEPS = 12;
/** `flows::MAX_VIA` — the engine's cap on a control's text, restated. */
const MAX_VIA = 80;

/**
 * Only what argv-safety needs: no leading `-` (clap would read a flag), no
 * control characters, bounded. Which ids EXIST is the engine's question —
 * `place_flow` matches an existing id verbatim precisely so a hand-written,
 * non-slug id can still be updated, and a stricter shim rule here refused
 * gestures the terminal accepted.
 */
function unsafeId(id: string): boolean {
	if (id.length === 0 || id.length > 100 || id.startsWith("-")) return true;
	// Control characters never belong in an id, and never in argv.
	return [...id].some((char) => {
		const code = char.codePointAt(0) ?? 0;
		return code < 0x20 || code === 0x7f;
	});
}

/**
 * Refused, never trimmed. `writeTicket`'s clamps only ever see fresh input;
 * this path also ECHOES a human's config (`bodyOf` re-sends what the manifest
 * shows), and a clamp here silently rewrote their long-hand `note` on every
 * gesture. `via`'s cap is `flows::MAX_VIA`; the rest only bound the payload.
 */
const STEP_CAPS = [
	["route", 200],
	["label", MAX_TITLE],
	["via", MAX_VIA],
	["viewport", 40],
	["note", 2000],
	["spec", MAX_TEXT],
] as const;

function oversized(step: FlowStepInput): string | null {
	for (const [key, cap] of STEP_CAPS) {
		if ((step[key] ?? "").length > cap) return `${key} (límite ${cap})`;
	}
	return null;
}

function isFlowWritten(
	value: unknown,
): value is { flowId: unknown; ticketId?: unknown; path?: unknown; created?: unknown } {
	return typeof value === "object" && value !== null && "flowId" in value;
}

/**
 * Writes go one at a time. The engine's config write is read-modify-write of
 * one file, so two gestures in flight would be last-writer-wins — the second
 * would resurrect what the first removed. The board also serialises its own
 * calls; this queue is the guarantee that survives a second tab.
 */
let writeQueue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
	const next = writeQueue.then(task, task);
	writeQueue = next.catch(() => {});
	return next;
}

/**
 * The storyboard's writer: `id: null` creates a journey via `flow new` (the
 * engine mints the id from the title); a string replaces — or adopts a
 * discovered journey under — that id via `flow set`. Then a `scan`, so the
 * map the viewer imports refreshes and the new screen arrives by hot reload.
 */
export async function saveFlow(input: SaveFlowInput): Promise<SaveFlowResult> {
	assertDev();
	return enqueue(() => writeFlowBody(input));
}

async function writeFlowBody(input: SaveFlowInput): Promise<SaveFlowResult> {
	const title = (input.title ?? "").trim();
	if (input.id === null && title.length === 0) return { ok: false, error: "Falta el título." };
	if (title.length > MAX_TITLE) {
		return { ok: false, error: `El título es demasiado largo (límite ${MAX_TITLE}).` };
	}
	if (input.id !== null && unsafeId(input.id)) {
		return { ok: false, error: "El id del recorrido no es válido." };
	}
	const steps = input.steps ?? [];
	const branches = input.branches ?? [];
	if (!steps.some((step) => (step.route ?? "").trim().length > 0)) {
		return { ok: false, error: "Un recorrido necesita al menos un paso con ruta." };
	}
	for (const step of [...steps, ...branches.flatMap((branch) => branch.steps ?? [])]) {
		const field = oversized(step);
		if (field) {
			return {
				ok: false,
				error: `Un texto del paso «${(step.route ?? "").slice(0, 60)}» es demasiado largo: ${field}.`,
			};
		}
	}
	for (const branch of branches) {
		if (
			(branch.label ?? "").length > MAX_TITLE ||
			(branch.from ?? "").length > 200 ||
			(branch.id ?? "").length > 100
		) {
			return {
				ok: false,
				error: `La rama «${(branch.label || branch.id || "").slice(0, 60)}» tiene un texto demasiado largo.`,
			};
		}
	}
	if (
		(input.description ?? "").length > MAX_TEXT ||
		(input.intent ?? "").length > MAX_TEXT ||
		(input.acceptance ?? "").length > MAX_TEXT
	) {
		return { ok: false, error: `Un texto del recorrido es demasiado largo (límite ${MAX_TEXT}).` };
	}
	const screens = steps.length + branches.reduce((total, b) => total + (b.steps?.length ?? 0), 0);
	if (screens > MAX_FLOW_STEPS) {
		// The engine's sentence, said before the round trip.
		return {
			ok: false,
			error: `un recorrido tiene como máximo ${MAX_FLOW_STEPS} pantallas, contando las ramas`,
		};
	}

	// Refused above or sent VERBATIM — never trimmed, because the body echoes
	// the human's config. Every other rule (the fork living in the trunk, twin
	// branch names) is the binary's, and it answers with the sentence the
	// terminal would print.
	const payload = JSON.stringify({
		title,
		description: input.description ?? "",
		intent: input.intent ?? "",
		acceptance: input.acceptance ?? "",
		steps,
		branches,
	});

	const argv =
		input.id === null ? ["flow", "new", title, "--json"] : ["flow", "set", input.id, "--json"];
	let saved: Pick<SaveFlowResult, "flowId" | "ticketId" | "file" | "created">;
	try {
		const child = run(binary(), argv, {
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
		const parsed: unknown = JSON.parse(stdout.trim());
		if (!isFlowWritten(parsed)) return { ok: true };
		saved = {
			flowId: String(parsed.flowId),
			ticketId: parsed.ticketId == null ? null : String(parsed.ticketId),
			file: parsed.path == null ? null : String(parsed.path),
			// `flow new` answers without the flag because it always creates.
			created: "created" in parsed ? Boolean(parsed.created) : true,
		};
	} catch (error) {
		return { ok: false, error: failure(error) };
	}

	// The flow commands scan to answer but write only the config and the
	// brief; the map the viewer imports is `.workbench/`, refreshed here so
	// the change arrives through the JSON import's hot reload — the
	// alternative was a success ending in "now run `workbench scan`", a dead
	// end in a tool whose point is the live map.
	try {
		await run(binary(), ["scan"], {
			cwd: process.cwd(),
			timeout: EXEC_TIMEOUT_MS,
			maxBuffer: EXEC_MAX_BUFFER,
		});
		return { ok: true, ...saved };
	} catch (error) {
		return {
			ok: true,
			...saved,
			note: `Se escribió, pero el scan falló: ${failure(error)}. Ejecuta \`workbench scan\` para ver el cambio.`,
		};
	}
}
