import { describe, expect, it } from "vitest";
import { sampleProps } from "./registry";
import type { PropSpec } from "./manifest.types";

function spec(partial: Partial<PropSpec> & { name: string }): PropSpec {
	return {
		typeText: "string",
		required: true,
		sample: { kind: "string", value: "Texto de ejemplo" },
		...partial,
	};
}

describe("sampleProps", () => {
	it("a callback becomes a shared no-op, never a JSON value", () => {
		const { props } = sampleProps([
			spec({ name: "onSelect", sample: { kind: "callback", value: "" } }),
			spec({ name: "onClose", sample: { kind: "callback", value: "" } }),
		]);
		expect(typeof props.onSelect).toBe("function");
		// The SAME function: a fresh closure per prop would defeat memo
		// comparisons inside the previewed component.
		expect(props.onSelect).toBe(props.onClose);
	});

	it("children travel as children, not as a prop", () => {
		const { props, children } = sampleProps([
			spec({ name: "children", sample: { kind: "node", value: "Hola" } }),
		]);
		expect(children).toBe("Hola");
		expect("children" in props).toBe(false);
	});

	it("boolean children are stringified because a bare boolean renders nothing", () => {
		const { children } = sampleProps([
			spec({ name: "children", sample: { kind: "string", value: true } }),
		]);
		expect(children).toBe("true");
	});

	it("a spec the scanner could not sample contributes nothing", () => {
		const { props } = sampleProps([spec({ name: "data", sample: null })]);
		expect(props).toEqual({});
	});
});
