/**
 * The two things a screen can grow into, and every surface's words for them.
 *
 * `journeyMoves` unified whether an act is legal. It did not unify what the
 * act is CALLED, and the copies drifted immediately: «Seguir aquí» was a
 * verbatim literal in two modules, while its sibling had already become
 * «Nueva rama» in one and «Nueva rama desde aquí» in the other. Both modules'
 * docblocks promised a person cannot get two different answers depending on
 * where they clicked, and both were wrong about it.
 *
 * So the words live here, once, with a field per surface — a popover button, a
 * menu row and a chip have genuinely different room, and pretending otherwise
 * is what produced the lowercasing and truncating each surface had started
 * inventing for itself. `flow-edit.ts` keeps the RULE and reads these; nothing
 * here decides anything.
 */

export interface JourneyAct {
	kind: "append" | "fork";
	/** One word, for a hover tag read in passing. Its own field rather than a
	 *  lowercased button label, because "seguir aquí" beside a gesture reads as
	 *  an instruction to click «aquí». */
	verb: string;
	/** The popover's button. */
	button: string;
	/** A menu row, which has room for the whole phrase. */
	menu: string;
	/** A chip under a screen. Null when the chip row already offers this act
	 *  elsewhere — appending belongs to the lane-tail ghost chip, anchored
	 *  where the new screen will actually appear, and two words for one gesture
	 *  is worse than one. The menu still carries it: at a far zoom the ghost is
	 *  hidden too. */
	chip: string | null;
	/** What it will do, in one line — the popover's copy under the title. */
	hint: string;
	/** The same, as a control's tooltip. */
	title: string;
}

export const APPEND: JourneyAct = {
	kind: "append",
	verb: "seguir",
	button: "Seguir aquí",
	menu: "Seguir aquí",
	chip: null,
	hint: "la nueva pantalla sigue a ésta",
	title: "Añade una pantalla después de ésta.",
};

export const FORK: JourneyAct = {
	kind: "fork",
	verb: "ramificar",
	button: "Nueva rama",
	menu: "Nueva rama desde aquí",
	chip: "+ rama",
	hint: "la nueva pantalla empieza una rama desde ésta",
	title: "Empieza una rama desde este paso.",
};

/* ------------------------------------------------- why an act is refused */

/**
 * The engine's own refusals, said the way a person reads them and BEFORE the
 * specification is typed rather than after.
 *
 * All four live together because they are the same kind of sentence: a rule
 * `crates/workbench-core` enforces, which no surface may phrase for itself.
 * Two of them used to sit apart in the board's module, which is how the
 * popover ended up unable to say them at all.
 */
export const ONLY_FROM_TRUNK = "Una rama sale siempre de un paso del tronco.";
export const ONLY_AT_THE_END = "Sólo se añade al final de una fila; desde el medio, se ramifica.";
export const AT_CAP = "El recorrido ya tiene todas las pantallas que caben.";
export const HAS_BRANCHES = "Este paso tiene ramas; quítalas primero.";

/** Why an editing control is parked. The board's own state, not the engine's. */
export const EN_CURSO = "Hay una escritura en curso.";

/** How the two mouse buttons read in a hover tag. */
export const CLICK = "clic";
export const RIGHT_CLICK = "clic derecho";
export const NOWHERE = "aquí no se puede añadir";
