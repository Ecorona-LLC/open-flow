import type { NewTicketInput, SaveFlowInput, TicketSummary } from "./pin";

/**
 * The production actions: functions that exist so the types line up, and refuse.
 *
 * Deliberately **no `"use server"` directive** — that absence is the entire
 * mechanism. A module without it registers no Server Action, so a production
 * build carries no ticket-writing entry point at all, rather than one that
 * checks `NODE_ENV` at call time and declines.
 *
 * They throw rather than returning a failure, because reaching them means the
 * workbench route was mounted in production, which is a misconfiguration worth
 * seeing in a log.
 */
const REFUSAL = "El taller sólo escribe en desarrollo.";

export async function createTicket(_input: NewTicketInput): Promise<never> {
	throw new Error(REFUSAL);
}

export async function loadTickets(): Promise<TicketSummary[]> {
	return [];
}

export async function saveFlow(_input: SaveFlowInput): Promise<never> {
	throw new Error(REFUSAL);
}
