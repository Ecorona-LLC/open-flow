"use server";

import { readTickets, writeTicket } from "./server";
import type { NewTicketInput, TicketSummary } from "./pin";

/**
 * The Server Actions, and the only `"use server"` module in this package.
 *
 * `package.json` maps `./actions` here under the `development` condition and to
 * `dev-actions.noop.ts` otherwise, so a production build resolves a module with
 * no directive in it and Next registers nothing.
 *
 * That indirection is the whole point, and it was arrived at by measurement.
 * With the host owning these instead, its layout and its workbench page had to
 * `import` them in order to pass them down — and those imports registered two
 * actions across **all six routes** of a production build, even though the
 * overlay had correctly resolved to a stub and the page was never visited.
 * Registered-but-refusing is weaker than absent, and absent was the goal.
 */
export async function createTicket(input: NewTicketInput) {
	return writeTicket(input);
}

export async function loadTickets(): Promise<TicketSummary[]> {
	return readTickets();
}
