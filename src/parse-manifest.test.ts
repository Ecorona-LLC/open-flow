import { afterEach, describe, expect, it, vi } from "vitest";
import { MANIFEST_VERSION } from "./manifest.types";

// Fresh module per test where the overlay warn latch matters — it is a
// module-level boolean, so without resetModules the tests would be
// order-dependent.
async function freshModule() {
	vi.resetModules();
	return import("./parse-manifest");
}

function fullManifest(): Record<string, unknown> {
	return {
		version: MANIFEST_VERSION,
		config: {},
		tokens: [],
		components: [],
		routes: [],
		flows: [],
		surfaces: [],
		stats: {},
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("parseManifest", () => {
	it("rejects a non-object with the command that fixes it", async () => {
		const { parseManifest } = await freshModule();
		expect(() => parseManifest(undefined)).toThrow(/workbench scan/);
	});

	it("rejects a manifest with no version as written by another tool", async () => {
		const { parseManifest } = await freshModule();
		expect(() => parseManifest({ config: {} })).toThrow(/no declara versión/);
	});

	it("rejects a version mismatch naming both versions", async () => {
		const { parseManifest } = await freshModule();
		expect(() => parseManifest({ ...fullManifest(), version: 999 })).toThrow(/999/);
	});

	it("names the missing top-level keys", async () => {
		const { parseManifest } = await freshModule();
		const incomplete = fullManifest();
		delete incomplete.flows;
		delete incomplete.tokens;
		expect(() => parseManifest(incomplete)).toThrow(/flows/);
	});

	it("returns the value itself when every key is present", async () => {
		const { parseManifest } = await freshModule();
		const value = fullManifest();
		expect(parseManifest(value)).toBe(value);
	});
});

describe("parseOverlayManifest", () => {
	it("accepts the trimmed slice without warning", async () => {
		const { parseOverlayManifest } = await freshModule();
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const overlay = {
			version: MANIFEST_VERSION,
			config: {},
			components: [],
			routes: [],
			surfaces: [],
		};
		expect(parseOverlayManifest(overlay)).toBe(overlay);
		expect(warn).not.toHaveBeenCalled();
	});

	it("warns exactly once when handed the full manifest", async () => {
		// The structural check cannot reject the full map — it is a superset —
		// which is how a root layout shipped 393 KB into every route with
		// nothing saying so. The warn is the tripwire.
		const { parseOverlayManifest } = await freshModule();
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		parseOverlayManifest(fullManifest());
		parseOverlayManifest(fullManifest());
		expect(warn).toHaveBeenCalledTimes(1);
		expect(String(warn.mock.calls[0]?.[0])).toContain("overlay.json");
	});
});
