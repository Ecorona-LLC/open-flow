import { journeyMoves } from "./flow-edit";
import { APPEND, FORK, HAS_BRANCHES } from "./journey-acts";

/**
 * What a screen on the board can be asked to do.
 *
 * The chips under a screen and the right-click menu over it are the same
 * actions in two places, and "the same" has to be literal or they drift: the
 * chips were the only surface for a while, so their availability rules lived
 * inside the JSX that drew them — a chain of `&&` mixing frame state, lane
 * kind and position, readable only by running it. Copying that chain into a
 * menu would have made two rules that agree until one is edited.
 *
 * So the rules are here, pure, and both surfaces render the list this returns.
 * The journey's own half of them is not even here — `journeyMoves` in
 * `flow-edit.ts` is the single answer, which the popover over a clicked control
 * reads too. Two modules holding the same four-case truth table is exactly what
 * this file was extracted to stop, and it would have been the same defect one
 * level up.
 *
 * Two ways an action can be missing, and the difference is deliberate:
 *
 * - **Absent** — it does not apply to this screen at all. A branch's steps
 *   never fork; only a row's last screen can be removed. Rendering those as
 *   greyed rows would put four dead entries under every screen.
 * - **`blocked`** — it applies, and is refused, and the SENTENCE is the point.
 *   Removing a step two branches leave from is the case: the person is right
 *   that it should be removable, and needs to know what to do first.
 */

export type NodeActionId = "demote" | "activate" | "refresh" | "append" | "fork" | "remove";

export interface NodeAction {
	id: NodeActionId;
	/** The menu's words — a full phrase, because a menu row has the room. */
	label: string;
	/** The chip's words, or null when the chip row does not carry this one.
	 *  See `journey-acts.ts`, which owns every surface's wording. */
	chip: string | null;
	title: string;
	/** Why it is refused here, said to the reader. Null when it can run. */
	blocked: string | null;
	/** Whether a write in flight or an open card should disable it. Only the
	 *  actions that write to the journey; refreshing a mirror never waits. */
	edits: boolean;
}

/** What a frame currently is, as the actions care about it. */
export type NodeFrame = "live" | "mirrored" | "restless" | "unbuilt" | "loading";

export interface NodeSituation {
	frame: NodeFrame;
	lane: "trunk" | "branch";
	/** Last of its own row. */
	isLast: boolean;
	/** A branch leaves this step — removing it would orphan that branch, which
	 *  the engine refuses. */
	isForkPoint: boolean;
	/** Its row would still have a screen after the removal. */
	removable: boolean;
	/** Whether this board can edit the journey at all. */
	canEdit: boolean;
	/** The journey already holds every screen the engine will accept. */
	atCap: boolean;
}

export interface NodeMenuContents {
	actions: NodeAction[];
	/** Why an action the journey could otherwise have is missing. The same
	 *  sentence the popover shows for the same screen — asked one way over a
	 *  control and another over the background, a person must not get two
	 *  different answers. The chip row is the exception and has to be: a row of
	 *  chips under a screen has no room for a sentence, which is why the chips
	 *  carry their refusals on the individual control instead. */
	note: string | null;
}

export function nodeActions(at: NodeSituation): NodeMenuContents {
	const actions: NodeAction[] = [];

	// What the frame is showing decides what can be done TO the frame.
	if (at.frame === "live") {
		actions.push({
			id: "demote",
			label: "Volver a espejo",
			chip: "Volver a espejo",
			title: "Congela la página en un espejo estático y libera el documento vivo.",
			blocked: null,
			edits: false,
		});
	} else if (at.frame === "mirrored") {
		actions.push(
			{
				id: "activate",
				label: "Activar la página",
				chip: "Activar",
				title: "Monta la página real para interactuar con ella.",
				blocked: null,
				edits: false,
			},
			{
				id: "refresh",
				label: "Actualizar el espejo",
				chip: "Actualizar",
				title: "Vuelve a cargar la ruta y captura un espejo nuevo.",
				blocked: null,
				edits: false,
			},
		);
	} else if (at.frame === "restless") {
		actions.push({
			id: "refresh",
			label: "Reintentar el espejo",
			chip: "Reintentar espejo",
			title: "La página no terminó de asentarse; vuelve a intentarlo.",
			blocked: null,
			edits: false,
		});
	}

	if (!at.canEdit) return { actions, note: null };

	// Literally the same source the click on a control reads, cap included.
	// A full journey turns both acts OFF rather than blocking them: at the cap
	// nothing can be added anywhere, and `note` carries the engine's sentence
	// once instead of stamping it on two dead rows.
	const moves = journeyMoves(at, at.atCap);
	const act = (from: typeof APPEND, id: "append" | "fork") =>
		actions.push({
			id,
			label: from.menu,
			chip: from.chip,
			title: from.title,
			blocked: null,
			edits: true,
		});
	if (moves.append) act(APPEND, "append");
	if (moves.fork) act(FORK, "fork");
	if (at.isLast && at.removable) {
		actions.push({
			id: "remove",
			label: "Quitar la pantalla",
			chip: "quitar",
			title: at.isForkPoint ? HAS_BRANCHES : "Quita esta pantalla del recorrido.",
			blocked: at.isForkPoint ? HAS_BRANCHES : null,
			edits: true,
		});
	}

	return { actions, note: moves.why };
}
