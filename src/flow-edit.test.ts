import { describe, expect, it } from "vitest";
import {
	appendStep,
	bodyOf,
	forkFrom,
	forkResolvesTo,
	hasStepAt,
	isForkPoint,
	removeLast,
	routeOfHref,
	stepInputOf,
	type ComposerTarget,
} from "./flow-edit";
import type { Flow, FlowStep } from "./manifest.types";

function step(route: string, extra: Partial<FlowStep> = {}): FlowStep {
	return {
		label: route,
		route,
		via: null,
		viewport: "movil",
		note: null,
		spec: null,
		exists: true,
		...extra,
	};
}

const flow: Flow = {
	id: "login",
	title: "Login",
	description: "Entrada",
	origin: "config",
	steps: [step("/"), step("/registro", { via: "Empezar", note: "cta" })],
	branches: [
		{ id: "tier-1", label: "Tier 1", from: 1, steps: [step("/panel", { via: "Continuar" })] },
	],
};

describe("bodyOf", () => {
	it("elides the default viewport so untouched steps keep following it", () => {
		// The manifest always resolves a viewport; echoing the default back
		// would pin every board-touched step to today's default forever.
		const body = bodyOf(flow, "movil");
		expect(body.steps[0]?.viewport).toBe("");
		const pinned = bodyOf(
			{ ...flow, steps: [step("/", { viewport: "escritorio" })], branches: [] },
			"movil",
		);
		expect(pinned.steps[0]?.viewport).toBe("escritorio");
	});

	it("re-sends what the manifest shows: ids echoed, from as the trunk route", () => {
		const body = bodyOf(flow);
		expect(body.title).toBe("Login");
		// `note` and `via` travel, so an update through `flow set` is lossless.
		expect(body.steps[1]).toEqual({
			route: "/registro",
			label: "/registro",
			via: "Empezar",
			viewport: "movil",
			note: "cta",
			spec: "",
		});
		expect(body.branches[0]?.id).toBe("tier-1");
		// The manifest's `from` is an index; the wire's is the trunk ROUTE.
		expect(body.branches[0]?.from).toBe("/registro");
	});
});

describe("edits", () => {
	const body = bodyOf(flow);

	it("appends to the addressed lane, immutably", () => {
		const next = appendStep(
			body,
			{ kind: "branch", index: 0, id: "tier-1" },
			{ route: "/facturas" },
		);
		expect(next.branches[0]?.steps.map((s) => s.route)).toEqual(["/panel", "/facturas"]);
		expect(body.branches[0]?.steps).toHaveLength(1);
	});

	it("forks a new branch from a trunk route", () => {
		const next = forkFrom(body, "/registro", "Tier 2", { route: "/panel/pro" });
		expect(next.branches[1]).toEqual({
			label: "Tier 2",
			from: "/registro",
			steps: [{ route: "/panel/pro" }],
		});
	});

	it("removing a branch's only step removes the branch; an emptied trunk stays honest", () => {
		const next = removeLast(body, { kind: "branch", index: 0, id: "tier-1" });
		expect(next.branches).toHaveLength(0);
		// A one-step trunk empties: the engine's sentence is the answer, not a
		// silent guard here — the board withholds the chip instead.
		const trunk = removeLast({ ...body, steps: body.steps.slice(0, 1) }, { kind: "trunk" });
		expect(trunk.steps).toHaveLength(0);
	});
});

describe("board questions", () => {
	it("knows a fork point and where a repeated route resolves", () => {
		expect(isForkPoint(flow, 1)).toBe(true);
		expect(isForkPoint(flow, 0)).toBe(false);
		// The engine forks from the FIRST occurrence of a repeated route.
		const repeated: Flow = { ...flow, steps: [step("/a"), step("/b"), step("/a")], branches: [] };
		expect(forkResolvesTo(repeated, "/a")).toBe(0);
	});

	it("routeOfHref keeps same-origin paths and drops the rest", () => {
		const origin = "http://localhost:3100";
		expect(routeOfHref("http://localhost:3100/panel/pro?x=1#y", origin)).toBe("/panel/pro");
		expect(routeOfHref("https://ejemplo.com/fuera", origin)).toBeNull();
		expect(routeOfHref("mailto:hola@ejemplo.com", origin)).toBeNull();
		expect(routeOfHref(null, origin)).toBeNull();
	});

	it("hasStepAt answers for trunk, branch and fork targets", () => {
		const trunkTail: ComposerTarget = {
			lane: { kind: "trunk" },
			after: 0,
			anchorRoute: "/",
			fork: false,
			flat: 0,
		};
		expect(hasStepAt(flow, trunkTail, "/registro")).toBe(true);
		const branchTail: ComposerTarget = {
			lane: { kind: "branch", index: 0, id: "tier-1" },
			after: 0,
			anchorRoute: "/panel",
			fork: false,
			flat: 2,
		};
		expect(hasStepAt(flow, branchTail, "/x")).toBe(false);
		const fork: ComposerTarget = {
			lane: { kind: "trunk" },
			after: 1,
			anchorRoute: "/registro",
			fork: true,
			flat: 1,
		};
		expect(hasStepAt(flow, fork, "/panel")).toBe(true);
		expect(hasStepAt(flow, fork, "/otro")).toBe(false);
	});

	it("a fork from a repeated route retires against the engine's first occurrence", () => {
		// The engine resolves `from` to the FIRST occurrence; a card forked on
		// the second, matched literally, waited forever for a branch that
		// would never say `from: 2`.
		const repeated: Flow = {
			...flow,
			steps: [step("/a"), step("/b"), step("/a")],
			branches: [{ id: "x", label: "X", from: 0, steps: [step("/x")] }],
		};
		const forkOnSecond: ComposerTarget = {
			lane: { kind: "trunk" },
			after: 2,
			anchorRoute: "/a",
			fork: true,
			flat: 2,
		};
		expect(hasStepAt(repeated, forkOnSecond, "/x")).toBe(true);
	});

	it("stepInputOf trims and omits empties; the viewport is always sent", () => {
		expect(stepInputOf({ route: " /pago ", label: " Pago ", spec: "", via: " " }, "movil")).toEqual(
			{ route: "/pago", label: "Pago", viewport: "movil" },
		);
	});
});
