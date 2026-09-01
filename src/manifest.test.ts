import { describe, expect, it } from "vitest";
import {
	byGroup,
	surfaceForRoute,
	surfaceFromPins,
	tokenCount,
	viewportById,
	workbenchUrl,
} from "./manifest";
import type { ComponentEntry, TokenGroup, Viewport, ViewerConfig } from "./manifest.types";

describe("tokenCount", () => {
	it("sums tokens across groups, since the manifest has no flat list", () => {
		const groups = [
			{ tokens: [{}, {}, {}] },
			{ tokens: [] },
			{ tokens: [{}] },
		] as unknown as TokenGroup[];
		expect(tokenCount(groups)).toBe(4);
		expect(tokenCount([])).toBe(0);
	});
});

function config(viewports: Viewport[] = []): ViewerConfig {
	return {
		title: "Taller",
		subtitle: "",
		mountPath: "/workbench",
		groupLabels: {},
		maxFlowSteps: 12,
		viewports,
	};
}

const movil: Viewport = { id: "movil", label: "Móvil", width: 390, height: 844, note: null };
const tablet: Viewport = { id: "tablet", label: "Tablet", width: 768, height: 1024, note: null };

describe("viewportById", () => {
	it("finds by id, falls back to the first, and refuses an empty list", () => {
		expect(viewportById(config([movil, tablet]), "tablet")).toBe(tablet);
		expect(viewportById(config([movil, tablet]), "no-existe")).toBe(movil);
		expect(() => viewportById(config([]), "movil")).toThrow(/viewport/);
	});
});

describe("workbenchUrl", () => {
	it("never doubles a slash whatever the mount path carries", () => {
		const trailing = { ...config(), mountPath: "/workbench/" };
		expect(workbenchUrl(trailing, "x")).toBe("/workbench/x");
		expect(workbenchUrl(config(), "")).toBe("/workbench");
	});
});

describe("surfaceForRoute", () => {
	const routes = [
		{ path: "/", surface: "landing", dynamic: false },
		{ path: "/panel", surface: "panel", dynamic: false },
		{ path: "/subjects/:slug", surface: "estudio", dynamic: true },
		{ path: "/subjects/archivo/:año", surface: "archivo", dynamic: true },
	];

	it("prefers an exact match", () => {
		expect(surfaceForRoute(routes, "/panel")).toBe("panel");
	});

	it("matches a dynamic route by its literal stem, longest stem winning", () => {
		expect(surfaceForRoute(routes, "/subjects/algebra")).toBe("estudio");
		// Both stems prefix this pathname; the longer one is the more
		// specific claim. (A parameter mid-path ends the stem, so
		// /subjects/:slug/notas could never out-claim /subjects/ — the stem
		// is the literal prefix BEFORE the first parameter.)
		expect(surfaceForRoute(routes, "/subjects/archivo/2026")).toBe("archivo");
	});

	it("does not let the root route claim every pathname", () => {
		// A stem of "/" would prefix-match everything; the length guard is
		// what stops the landing surface from owning the whole app.
		expect(surfaceForRoute(routes, "/otra-cosa")).toBeNull();
	});
});

describe("surfaceFromPins", () => {
	const pin = (surface: string | null) => ({ node: surface === null ? null : { surface } });

	it("most-pinned surface wins and ties go to the first pinned", () => {
		expect(surfaceFromPins([pin("a"), pin("b"), pin("b")], "x")).toBe("b");
		expect(surfaceFromPins([pin("a"), pin("b")], "x")).toBe("a");
	});

	it("falls back when no pin resolved a surface", () => {
		expect(surfaceFromPins([pin(null)], "x")).toBe("x");
	});
});

describe("byGroup", () => {
	it("groups in first-appearance order", () => {
		const entry = (id: string, group: string) => ({ id, group }) as ComponentEntry;
		const grouped = byGroup([entry("a", "ui"), entry("b", "marketing"), entry("c", "ui")]);
		expect(grouped.map(([group]) => group)).toEqual(["ui", "marketing"]);
		expect(grouped[0]?.[1]).toHaveLength(2);
	});
});
