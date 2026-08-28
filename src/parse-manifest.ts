import { MANIFEST_VERSION, type Manifest, type OverlayManifest } from "./manifest.types";

/**
 * Turn the imported JSON into a `Manifest`, or say clearly why not.
 *
 * The file is generated, so this is not defending against a hostile input — it
 * is defending against a *stale* one. The failure it exists for is real and
 * common: someone upgrades the package, does not re-run `workbench scan`, and
 * the viewer renders four empty panels with no clue why. A thrown message
 * naming the command beats that every time.
 *
 * Structural, not exhaustive. Checking every field of every component would be
 * a second copy of the schema, which is the duplication this whole design
 * removes; the version number is what actually guarantees the shape.
 */
export function parseManifest(value: unknown): Manifest {
	if (typeof value !== "object" || value === null) {
		throw new Error("No se pudo leer .workbench/manifest.json. Ejecuta `workbench scan`.");
	}

	const version = Reflect.get(value, "version");
	if (typeof version !== "number") {
		throw new Error(
			"El manifiesto no declara versión. Fue escrito por otra herramienta, o está a medias — ejecuta `workbench scan`.",
		);
	}
	if (version !== MANIFEST_VERSION) {
		throw new Error(
			`El manifiesto es de la versión ${version} y este visor lee la ${MANIFEST_VERSION}. ` +
				"Ejecuta `workbench scan` con la misma versión del paquete que tienes instalada.",
		);
	}

	const missing = REQUIRED.filter((key) => Reflect.get(value, key) === undefined);
	if (missing.length > 0) {
		throw new Error(`Al manifiesto le falta ${missing.join(", ")}. Ejecuta \`workbench scan\`.`);
	}

	// A predicate rather than an assertion: `as Manifest` would claim the shape,
	// this checks it. The claim it can honestly make — every top-level key is
	// present and the version matches the one these types were generated from —
	// is the strongest available without re-declaring the schema here, which is
	// the duplication the generated types exist to remove.
	if (!hasEveryKey(value)) {
		throw new Error("El manifiesto está incompleto. Ejecuta `workbench scan`.");
	}
	return value;
}

const REQUIRED = [
	"config",
	"tokens",
	"components",
	"routes",
	"flows",
	"surfaces",
	"stats",
] as const;

function hasEveryKey(value: object): value is Manifest {
	return REQUIRED.every((key) => Reflect.get(value, key) !== undefined);
}

const OVERLAY_REQUIRED = ["config", "components", "routes", "surfaces"] as const;

function hasOverlayKeys(value: object): value is OverlayManifest {
	return OVERLAY_REQUIRED.every((key) => Reflect.get(value, key) !== undefined);
}

// Once per session: the overlay renders on every route, and the mistake it
// flags is made once, in one layout file.
let warnedFullManifest = false;

/**
 * The same check for `.workbench/overlay.json`.
 *
 * A separate entry point rather than a looser `parseManifest`: the overlay file
 * is deliberately a different, smaller shape. The structural check alone cannot
 * reject the full manifest — it is a superset, so it passes every key test —
 * which is exactly how a root layout kept shipping the 393 KB map into every
 * route's RSC payload with nothing saying so. Hence the warning below: warn,
 * not throw, because this runs in the root layout of every route and a throw
 * here takes the whole app down on upgrade.
 */
export function parseOverlayManifest(value: unknown): OverlayManifest {
	if (typeof value !== "object" || value === null) {
		throw new Error("No se pudo leer .workbench/overlay.json. Ejecuta `workbench scan`.");
	}
	const version = Reflect.get(value, "version");
	if (version !== MANIFEST_VERSION) {
		throw new Error(
			`El overlay es de la versión ${String(version)} y este visor lee la ${MANIFEST_VERSION}. ` +
				"Ejecuta `workbench scan` con la misma versión del paquete que tienes instalada.",
		);
	}
	if (!hasOverlayKeys(value)) {
		throw new Error("Al overlay le faltan campos. Ejecuta `workbench scan`.");
	}
	// `flows` and `tokens` exist only on the full manifest.
	if (
		!warnedFullManifest &&
		(Reflect.get(value, "flows") !== undefined || Reflect.get(value, "tokens") !== undefined)
	) {
		warnedFullManifest = true;
		console.warn(
			"[workbench] El overlay recibió el manifiesto completo. Importa `.workbench/overlay.json` " +
				"en el layout — `workbench scan` ya lo genera y pesa una quinta parte del mapa completo, " +
				"que ahora mismo viaja en el payload de cada ruta.",
		);
	}
	return value;
}
