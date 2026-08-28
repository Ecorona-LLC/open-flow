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
