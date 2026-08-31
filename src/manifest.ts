/**
 * The manifest, and the handful of questions the viewer asks of it.
 *
 * Every type here is generated from the Rust that emits the file, so this
 * module holds only *derived* accessors — never a second declaration of the
 * shape, and never a re-implementation of something the scanner already
 * computed. `weight` and `predictedFiles` used to be recomputed in TypeScript
 * under a comment reading "Mirrors `weightFor` in scripts/workbench/ticket.mjs";
 * they are fields now.
 */
import type { ComponentEntry, Flow, TokenGroup, Viewport, ViewerConfig } from "./manifest.types";

export type {
	ComponentEntry,
	Flow,
	FlowStep,
	FlowBranch,
	HardcodedColor,
	LearnedFile,
	Manifest,
	Origin,
	PropSample,
	PropSpec,
	Renderability,
	RouteEntry,
	RouteKind,
	SampleKind,
	SampleValue,
	ScanStats,
	Surface,
	SurfaceFiles,
	Token,
	TokenGroup,
	TokenKind,
	TokenUse,
	Viewport,
	ViewerConfig,
	Weight,
} from "./manifest.types";
export { MANIFEST_VERSION } from "./manifest.types";

/** Display label for a group, falling back to the raw path segment. */
export function groupLabel(config: ViewerConfig, group: string): string {
	return config.groupLabels[group] ?? group;
}

/**
 * Resolve a viewport id.
 *
 * The scanner guarantees `viewports` is non-empty, so there is no
 * `FALLBACK_VIEWPORT` const here. That one existed only because the old config
 * could legally declare an empty array.
 */
export function viewportById(config: ViewerConfig, id: string | undefined): Viewport {
	const found = config.viewports.find((viewport) => viewport.id === id);
	const first = config.viewports[0];
	if (found) return found;
	if (first) return first;
	throw new Error("El manifiesto no declara ningún viewport.");
}

/** `<mountPath>/<segment>?<query>` — the viewer never hardcodes its own route. */
export function workbenchUrl(
	config: ViewerConfig,
	segment: string,
	params?: URLSearchParams,
): string {
	const base = config.mountPath.replace(/\/+$/, "");
	const path = segment ? `${base}/${segment}` : base;
	return params ? `${path}?${params.toString()}` : path;
}

/** Components grouped for the rail, in the order the groups first appear. */
export function byGroup(components: ComponentEntry[]): Array<[string, ComponentEntry[]]> {
	const groups = new Map<string, ComponentEntry[]>();
	for (const component of components) {
		const existing = groups.get(component.group);
		if (existing) existing.push(component);
		else groups.set(component.group, [component]);
	}
	return [...groups.entries()];
}

/** Most-pinned surface wins; ties go to the first pinned. */
export function surfaceFromPins(
	pins: Array<{ node: { surface: string | null } | null }>,
	fallback: string,
): string {
	const counts = new Map<string, number>();
	for (const pin of pins) {
		const id = pin.node?.surface;
		if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
	}
	let best: string | null = null;
	for (const [id, count] of counts) {
		if (best === null || count > (counts.get(best) ?? 0)) best = id;
	}
	return best ?? fallback;
}

/** The surface a route mounts. Precomputed by the scanner. */
export function surfaceForRoute(
	// Structural, so the overlay's trimmed route list satisfies it too.
	routes: ReadonlyArray<{ path: string; surface: string | null; dynamic: boolean }>,
	pathname: string,
): string | null {
	const exact = routes.find((route) => route.path === pathname);
	if (exact) return exact.surface;
	// A dynamic route's manifest path is `/subjects/:slug`, which never equals a
	// real pathname; match on the literal prefix before the first parameter.
	const prefixed = routes
		.filter((route) => route.dynamic)
		.map((route) => ({ route, stem: route.path.split(/[:*]/)[0] ?? "" }))
		.filter(({ stem }) => stem.length > 1 && pathname.startsWith(stem))
		.sort((a, b) => b.stem.length - a.stem.length)[0];
	return prefixed?.route.surface ?? null;
}

/**
 * The isolated single-screen view.
 *
 * The same route with different parameters, not a second page: a host that
 * mounts one path gets the panels and the isolated viewer both, and there is no
 * catch-all segment to explain in the install instructions.
 */
export function frameUrl(config: ViewerConfig, params: Record<string, string>): string {
	return workbenchUrl(config, "", new URLSearchParams({ view: "frame", ...params }));
}

/** A flow by id, or the first one. */
/**
 * How many tokens a set of groups holds. Tokens are grouped in the manifest,
 * so there is no flat list to `.length` — and the rail and the Elementos
 * panel had each written this reduce for themselves.
 */
export function tokenCount(groups: TokenGroup[]): number {
	return groups.reduce((count, group) => count + group.tokens.length, 0);
}

export function flowById(flows: Flow[], id: string | undefined): Flow | undefined {
	return flows.find((flow) => flow.id === id) ?? flows[0];
}
