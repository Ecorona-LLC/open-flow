import { describe, expect, it } from "vitest";
import { journeyMoves } from "./flow-edit";
import { AT_CAP } from "./journey-acts";
import { nodeActions, type NodeSituation } from "./node-actions";

function at(over: Partial<NodeSituation> = {}): NodeSituation {
	return {
		frame: "mirrored",
		lane: "trunk",
		isLast: true,
		isForkPoint: false,
		removable: true,
		canEdit: true,
		atCap: false,
		...over,
	};
}

const ids = (situation: NodeSituation) => nodeActions(situation).actions.map((a) => a.id);

describe("nodeActions", () => {
	it("offers what the frame's own state allows, and only that", () => {
		expect(ids(at({ frame: "live" }))).toContain("demote");
		expect(ids(at({ frame: "live" }))).not.toContain("activate");
		expect(ids(at({ frame: "mirrored" }))).toEqual(expect.arrayContaining(["activate", "refresh"]));
		expect(ids(at({ frame: "restless" }))).toContain("refresh");
		// Nothing to activate, refresh or demote: the page does not exist yet,
		// and one still being captured is mid-sweep.
		expect(ids(at({ frame: "unbuilt" }))).toEqual(["append", "fork", "remove"]);
		expect(ids(at({ frame: "loading" }))).toEqual(["append", "fork", "remove"]);
	});

	it("follows the journey's rules for the edits", () => {
		// Mid-row: cannot continue, cannot be removed; the trunk can still fork.
		expect(ids(at({ isLast: false }))).toEqual(["activate", "refresh", "fork"]);
		// A branch never forks — the engine takes `from` from the trunk only.
		expect(ids(at({ lane: "branch" }))).toEqual(["activate", "refresh", "append", "remove"]);
		// The last screen of a row that would be left empty stays.
		expect(ids(at({ removable: false }))).not.toContain("remove");
	});

	it("keeps a refused removal visible, with the reason", () => {
		const remove = nodeActions(at({ isForkPoint: true })).actions.find((a) => a.id === "remove");
		expect(remove?.blocked).toBe("Este paso tiene ramas; quítalas primero.");
		// And says the same thing on hover, rather than a second wording.
		expect(remove?.title).toBe(remove?.blocked);
		expect(nodeActions(at()).actions.find((a) => a.id === "remove")?.blocked).toBeNull();
	});

	it("drops every edit when the board cannot edit, and keeps the frame's own", () => {
		expect(ids(at({ canEdit: false }))).toEqual(["activate", "refresh"]);
		expect(ids(at({ canEdit: false, frame: "unbuilt" }))).toEqual([]);
	});

	it("marks exactly the actions that wait for a write in flight", () => {
		const writes = nodeActions(at())
			.actions.filter((action) => action.edits)
			.map((action) => action.id);
		// Refreshing a mirror is not an edit to the journey and never waits.
		expect(writes).toEqual(["append", "fork", "remove"]);
	});

	it("says why, in the same words the popover uses over a control", () => {
		// One rule, one sentence. A person who asks over a button and a person
		// who asks over the background must not get two different answers.
		expect(nodeActions(at({ isLast: false })).note).toBe(
			journeyMoves({ lane: "trunk", isLast: false }).why,
		);
		expect(nodeActions(at({ lane: "branch" })).note).toBe(
			journeyMoves({ lane: "branch", isLast: true }).why,
		);
		expect(nodeActions(at()).note).toBeNull();
	});

	it("offers append and fork exactly when the clicked-control rule does", () => {
		for (const lane of ["trunk", "branch"] as const) {
			for (const isLast of [true, false]) {
				const moves = journeyMoves({ lane, isLast });
				const offered = ids(at({ lane, isLast }));
				expect(offered.includes("append")).toBe(moves.append);
				expect(offered.includes("fork")).toBe(moves.fork);
			}
		}
	});

	it("says the journey is full instead of offering a screen the engine refuses", () => {
		const full = nodeActions(at({ atCap: true }));
		const offered = full.actions.map((action) => action.id);
		// Neither act that GROWS the journey survives — at the cap nothing can
		// be added anywhere, so two greyed rows would say the same thing twice.
		// The sentence is carried once, by the note, exactly as the popover
		// carries it for the same screen.
		expect(offered).not.toContain("append");
		expect(offered).not.toContain("fork");
		expect(full.note).toBe(AT_CAP);
		// Everything that does NOT grow the journey still works.
		expect(offered).toEqual(["activate", "refresh", "remove"]);
		expect(full.actions.find((action) => action.id === "remove")?.blocked).toBeNull();
	});

	it("hands the cap to the same rule the popover reads", () => {
		// One answer, or the two surfaces disagree about a full journey.
		for (const lane of ["trunk", "branch"] as const) {
			for (const isLast of [true, false]) {
				const moves = journeyMoves({ lane, isLast }, true);
				expect(moves).toEqual({ append: false, fork: false, why: AT_CAP });
			}
		}
	});
});
