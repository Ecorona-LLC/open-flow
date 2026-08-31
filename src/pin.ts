/**
 * What a click in edit mode captured, and what a ticket carries.
 *
 * These are the viewer's own types rather than generated ones: they describe
 * what the browser saw, travel *to* the scanner, and have no counterpart in the
 * manifest. The scanner deserialises the same shape in `tickets.rs`, which is
 * why the field names here are not negotiable.
 */

export interface Pin {
	note: string;
	element: {
		tag: string;
		classes: string;
		text: string;
		path: string;
	};
	/** Resolved through the React fiber plus the manifest's component list. */
	node: {
		component: string;
		file: string | null;
		surface: string | null;
	} | null;
}

/** An error seen while the workbench was open. In memory only. */
export interface RuntimeError {
	message: string;
	component: string | null;
	file: string | null;
	/** The frame's route, when it came from a flow iframe. */
	route: string | null;
	at: string;
}

/** What the viewer sends to `workbench ticket --json`. */
export interface NewTicketInput {
	surface: string;
	title: string;
	intent: string;
	acceptance: string;
	pins: Pin[];
	errors: RuntimeError[];
	/** The route you were on when you picked. Recorded in the ticket. */
	route?: string;
}

export interface TicketSummary {
	id: string;
	title: string;
	surface: string | null;
	status: string;
	created: string | null;
	/** How many files this ticket had to teach the map. */
	misses: number;
	file: string;
}

/**
 * One step of a journey, as `workbench flow new/set --json` read it. Field
 * names are serde's camelCase of `FlowStepInput` in `tickets.rs` — not
 * negotiable, like everything else in this file.
 */
export interface FlowStepInput {
	route: string;
	label?: string;
	/** The control on the previous screen that leads here («Iniciar sesión»). */
	via?: string;
	/** A `Viewport.id`. */
	viewport?: string;
	/** A caption for a screen that exists; echoed back so an update never eats it. */
	note?: string;
	/** What the screen must do — why a journey can be authored before it exists. */
	spec?: string;
}

/** A fork: its own steps, continuing from the trunk step whose route is `from`. */
export interface FlowBranchInput {
	/** Echoed back on updates so a lane's id — and the storyboard row keyed on it — never shifts. */
	id?: string;
	label: string;
	from: string;
	steps: FlowStepInput[];
}

/** The journey body both flow commands read (`FlowInput`/`FlowSetInput` in `tickets.rs`). */
export interface FlowBody {
	title: string;
	description: string;
	intent: string;
	acceptance: string;
	steps: FlowStepInput[];
	branches: FlowBranchInput[];
}

/**
 * What the viewer sends to the host's `saveFlow` action. `id: null` creates
 * via `flow new` (the engine mints the id from the title); a string updates —
 * or adopts a discovered journey — via `flow set <id>`.
 */
export type SaveFlowInput = FlowBody & { id: string | null };

export interface SaveFlowResult {
	ok: boolean;
	flowId?: string;
	ticketId?: string | null;
	file?: string | null;
	created?: boolean;
	/** Written, but the map did not refresh: what to do about it. */
	note?: string;
	error?: string;
}
