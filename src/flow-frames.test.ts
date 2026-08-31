import { describe, expect, it } from "vitest";
import {
	frameOf,
	NO_FRAMES,
	nextCapture,
	prune,
	QUEUED,
	withFrame,
	type Frames,
} from "./flow-frames";
import type { StepNode } from "./flow-layout";
import type { FlowStep } from "./manifest.types";

function node(key: string, exists = true): StepNode {
	const step: FlowStep = {
		label: key,
		route: `/${key}`,
		via: null,
		viewport: "movil",
		note: null,
		spec: null,
		exists,
	};
	return {
		key,
		flat: 0,
		number: 1,
		step,
		viewport: { id: "movil", label: "Móvil", width: 390, height: 844, note: null },
	};
}

describe("frameOf", () => {
	it("derives unbuilt from the step, never the ledger", () => {
		// A stale `queued` under a spec card once held the capture slot for the
		// full watchdog; the step's own `exists` is the truth.
		const stale = withFrame(NO_FRAMES, "a", QUEUED);
		expect(frameOf(stale, node("a", false)).kind).toBe("unbuilt");
		expect(frameOf(NO_FRAMES, node("b")).kind).toBe("queued");
	});
});

describe("nextCapture", () => {
	it("is null while one is in flight, else the first queued in flat order", () => {
		const nodes = [node("a"), node("b", false), node("c")];
		expect(nextCapture(NO_FRAMES, nodes)).toBe("a");
		const capturing = withFrame(NO_FRAMES, "a", { kind: "capturing", ticket: 1 });
		expect(nextCapture(capturing, nodes)).toBeNull();
		const done = withFrame(NO_FRAMES, "a", { kind: "mirrored", srcdoc: "x", capturedAt: 1 });
		expect(nextCapture(done, nodes)).toBe("c");
	});
});

describe("prune", () => {
	it("keeps unchanged keys' mirrors across an append and drops a removed tail", () => {
		const mirror = { kind: "mirrored", srcdoc: "x", capturedAt: 1 } as const;
		let frames: Frames = withFrame(
			withFrame(NO_FRAMES, "trunk:0:/", mirror),
			"trunk:1:/registro",
			mirror,
		);
		const appended = [node("trunk:0:/"), node("trunk:1:/registro"), node("trunk:2:/panel")];
		// Appending a screen adds a key; nothing existing dies — and the ledger
		// keeps its identity, so effects keyed on it do not re-fire.
		expect(prune(frames, appended)).toBe(frames);

		frames = withFrame(frames, "trunk:2:/panel", mirror);
		const removed = prune(frames, appended.slice(0, 2));
		expect(removed.has("trunk:2:/panel")).toBe(false);
		expect(removed.get("trunk:0:/")).toBe(mirror);
	});

	it("drops the mirror of a step that became unbuilt", () => {
		// A snapshot of a deleted page must not resurface if the route is
		// later rebuilt — and its srcdoc has no business parked under a spec
		// card.
		const mirror = { kind: "mirrored", srcdoc: "x", capturedAt: 1 } as const;
		const frames = withFrame(NO_FRAMES, "trunk:0:/", mirror);
		const unbuilt = prune(frames, [node("trunk:0:/", false)]);
		expect(unbuilt.has("trunk:0:/")).toBe(false);
	});
});
