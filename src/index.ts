/**
 * The package's own entry point: types, and the pure helpers over them.
 *
 * Nothing here renders. The React surface lives behind `./app` (the client
 * mount) and `./overlay` (the live picker) so that importing a type never
 * drags a client component into a server module.
 */
export {
	byGroup,
	flowById,
	tokenCount,
	frameUrl,
	groupLabel,
	surfaceForRoute,
	surfaceFromPins,
	viewportById,
	workbenchUrl,
	MANIFEST_VERSION,
} from "./manifest";

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
} from "./manifest";

export { parseManifest } from "./parse-manifest";
export type { RegistryEntry } from "./registry";
export type {
	FlowBody,
	FlowBranchInput,
	FlowStepInput,
	NewTicketInput,
	Pin,
	RuntimeError,
	SaveFlowInput,
	SaveFlowResult,
	TicketSummary,
} from "./pin";
