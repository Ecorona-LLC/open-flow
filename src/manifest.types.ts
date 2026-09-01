// AUTO-GENERATED from crates/workbench-core/src/manifest.rs — do not edit by hand.
// Regenerate with `cargo test -p workbench-core`. CI fails when this file is dirty.
//
// These are the types the `workbench` binary actually emits, so the viewer
// cannot drift from the scanner that feeds it.

export type Viewport = { id: string, label: string, width: number, height: number, 
/**
 * Which Tailwind breakpoint this width exercises, e.g. `md` or `< sm`.
 */
note: string | null, };

export type ViewerConfig = { title: string, subtitle: string, mountPath: string, groupLabels: { [key in string]: string }, viewports: Array<Viewport>, 
/**
 * The most screens a journey may hold, trunk and branches together.
 *
 * Sent because the storyboard offers «+ pantalla» and «+ rama» on every
 * screen and every control, and without it the offer stands on a full
 * journey right up until the engine refuses it — after the specification
 * has been typed. The alternative was a `12` written a second time in
 * TypeScript, which is the hand-synchronised constant this crate exists
 * to make impossible.
 */
maxFlowSteps: number, };

export type TokenKind = "color" | "value";

export type Token = { name: string, light: string | null, dark: string | null, 
/**
 * A trailing CSS comment on the declaration line, kept as documentation.
 */
note: string | null, kind: TokenKind, };

export type TokenGroup = { id: string, label: string, tokens: Array<Token>, };

export type Renderability = "auto" | "synthesized" | "needs-demo" | "server" | "demo";

export type SampleKind = "string" | "number" | "boolean" | "node" | "enum" | "callback" | "list";

export type SampleValue = string | number | boolean | Array<SampleValue> | null;

export type PropSample = { kind: SampleKind, value: SampleValue, };

export type PropSpec = { name: string, 
/**
 * The annotation as written, so the panel can show what it could not invent.
 */
typeText: string, required: boolean, sample: PropSample | null, };

export type VariantGroup = { 
/**
 * The prop this axis drives — `variant`, `size`, `tone`.
 */
name: string, values: Array<string>, 
/**
 * From `defaultVariants`. `None` when the call declares none.
 */
default: string | null, };

export type ComponentEntry = { 
/**
 * Path-derived, e.g. `ui/button`. Stable across scans.
 */
id: string, 
/**
 * The exported React name, e.g. `Button`.
 */
name: string, 
/**
 * First path segment under the demo root, e.g. `ui`. Labelled via config.
 */
group: string, 
/**
 * Repo-relative source path.
 */
file: string, 
/**
 * What the generated registry imports, e.g. `@/components/ui/button`.
 */
importPath: string, 
/**
 * `None` means the component is the module's default export.
 */
exportName: string | null, verdict: Renderability, props: Array<PropSpec>, 
/**
 * Variant axes from a `cva` call in the same file. Empty when there is
 * none — plenty of components are not built that way.
 */
variants: Array<VariantGroup>, 
/**
 * Repo-relative `*.demo.tsx` when one exists.
 */
demoFile: string | null, 
/**
 * Which surface owns it, when the map knows.
 */
surface: string | null, };

export type RouteKind = "page" | "handler";

export type RouteEntry = { 
/**
 * `/subjects/:slug` — dynamic segments named, groups stripped.
 */
path: string, file: string, 
/**
 * The `(group)` it lives in, when any.
 */
group: string | null, kind: RouteKind, dynamic: boolean, 
/**
 * The most specific surface mounted here. Precomputed, so the viewer stops
 * re-deriving it per hover.
 */
surface: string | null, };

export type Origin = "config" | "spider";

export type FlowStep = { label: string, route: string, 
/**
 * The control on the previous screen that leads here ("Iniciar sesión"),
 * as its author wrote it. Absent on every spider step — a navigation
 * edge carries no link text — and on a declared step nobody labelled.
 */
via: string | null, 
/**
 * A `Viewport.id`, already resolved against the config.
 */
viewport: string, 
/**
 * The author's own caption, echoed back untouched by an edit.
 */
note: string | null, 
/**
 * The scan's own remark about this step, kept apart from `note` because
 * the board re-sends the whole flow on every edit and cannot tell an
 * authored value from a derived one.
 *
 * It used to be CONCATENATED onto `note`, so the first gesture on a
 * trimmed journey wrote «Se declararon 14 pasos; se muestran los primeros
 * 12.» into `workbench.config.json` as if a person had typed it, where it
 * then outlived the trim it described and collected a second copy on the
 * next scan. Derived, so it never travels back.
 */
notice: string | null, 
/**
 * What this screen must do. Present on a step somebody authored; absent on
 * one the spider found, which by definition already exists.
 */
spec: string | null, 
/**
 * Whether the route is in the route table.
 *
 * Derived, never authored: a step flips to `true` on the scan after its
 * page lands, with no edit to the flow declaration. That is what keeps a
 * spec card provisional rather than a fixture.
 */
exists: boolean, };

export type FlowBranch = { id: string, label: string, 
/**
 * Zero-based index into `Flow.steps` of the step this branch continues
 * from. Resolved at scan time from the route the config names, and
 * always in range: a branch whose route is not in the trunk never
 * reaches the manifest (it is announced and dropped).
 */
from: number, steps: Array<FlowStep>, };

export type Flow = { id: string, title: string, description: string | null, origin: Origin, steps: Array<FlowStep>, 
/**
 * Empty for every spider flow: a discovered journey is one path through
 * the nav graph. Only a hand-declared flow forks.
 */
branches: Array<FlowBranch>, };

export type LearnedFile = { file: string, ticket: string | null, };

export type SurfaceFiles = { anchors: Array<string>, 
/**
 * Reached through the import graph, stopping at shared primitives.
 */
members: Array<string>, 
/**
 * Real importers under the app directory — the layouts that render it.
 */
mounts: Array<string>, learned: Array<LearnedFile>, };

export type TokenUse = { token: string, uses: number, };

export type HardcodedColor = { file: string, values: Array<string>, };

export type Weight = "quick" | "full";

export type Surface = { id: string, label: string, description: string, origin: Origin, 
/**
 * The one file to change first.
 */
main: string | null, files: SurfaceFiles, 
/**
 * Design-system primitives it leans on. Shared — don't edit casually.
 */
shared: Array<string>, 
/**
 * Non-UI modules it calls. Recorded at the boundary, never expanded.
 */
logic: Array<string>, routes: Array<string>, 
/**
 * Route groups that deliberately render none of this. The useful half.
 */
absent: Array<string>, tokens: Array<TokenUse>, 
/**
 * Literal colours where a token was expected.
 */
hardcodedColors: Array<HardcodedColor>, 
/**
 * Component ids covering its parts — gaps are visible by omission.
 */
components: Array<string>, gotchas: Array<string>, 
/**
 * Every file the map predicts for this surface, deduplicated. Derived
 * here so the CLI's `learn` and the viewer's badge cannot disagree.
 */
predictedFiles: Array<string>, weight: Weight, };

export type ParseFailure = { file: string, message: string, };

export type ScanStats = { filesScanned: number, elapsedMs: bigint, parseFailures: Array<ParseFailure>, 
/**
 * Navigation targets the spider could not resolve to a literal route —
 * a computed `href`. Counted so the Flujos panel can say how many.
 */
untraceableHrefs: number, 
/**
 * The resolved stylesheet path, when nothing was there. Carried into the
 * manifest, not just stderr: an empty Elementos tab with no explanation
 * reads as "this repo has no tokens", which is the wrong lesson.
 */
missingStylesheet: string | null, 
/**
 * Journeys found past the cap and not shown. Same rule as
 * `untraceable_hrefs`: a silent cap reads as "that is all of them".
 */
droppedFlows: number, };

export type Manifest = { version: number, 
/**
 * `workbench 0.1.0` — printed in the viewer so a stale scan is visible.
 */
generatedBy: string, config: ViewerConfig, tokens: Array<TokenGroup>, components: Array<ComponentEntry>, routes: Array<RouteEntry>, flows: Array<Flow>, surfaces: Array<Surface>, stats: ScanStats, };

export type OverlayComponent = { name: string, file: string, surface: string | null, };

export type OverlayRoute = { path: string, surface: string | null, dynamic: boolean, };

export type OverlaySurface = { id: string, label: string, weight: Weight, predictedFileCount: number, };

export type OverlayManifest = { version: number, config: ViewerConfig, components: Array<OverlayComponent>, routes: Array<OverlayRoute>, surfaces: Array<OverlaySurface>, };

export const MANIFEST_VERSION = 3;
