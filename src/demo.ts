/**
 * The entire authoring API — now an escape hatch rather than an entry fee.
 *
 * The spider lists and renders what it can on its own. A demo file is for the
 * cases it cannot: a component whose required props are callbacks or domain
 * objects, or one whose interesting states need naming.
 *
 *   // src/components/ui/tag.demo.tsx  →  covers `Tag`
 *   "use client";
 *   import { Tag } from "@/components/ui/tag";
 *   import { defineDemo, scenario } from "@open-flow/ui/demo";
 *
 *   export default defineDemo({
 *     render: () => <Tag>Vigente</Tag>,
 *     scenarios: [scenario("Variantes", () => <Tag variant="outline">outline</Tag>)],
 *   });
 *
 * Import the REAL component. A demo that re-implements the markup is the
 * duplication this tool exists to avoid — if a scenario needs something the
 * component cannot express, that is a gap in the component, not in the demo.
 *
 * Demos compile into the client graph, so anything `async`, DB-backed or
 * importing `server-only` cannot have one. The scanner grades those `server`
 * and points at a flow instead, which renders the real page.
 */
import type { ReactNode } from "react";

/** One named render inside a demo — a variant row, a state, an edge case. */
export interface Scenario {
	name: string;
	description?: string;
	render: () => ReactNode;
}

export interface Demo {
	/** Defaults to the component's name when omitted. */
	title?: string;
	description?: string;
	/** The headline render. */
	render: () => ReactNode;
	scenarios?: Scenario[];
	/** Render on a dark surface first, for components that only exist there. */
	preferDark?: boolean;
}

export interface DemoModule {
	default: Demo;
}

export function defineDemo(demo: Demo): Demo {
	return demo;
}

export function scenario(name: string, render: () => ReactNode, description?: string): Scenario {
	return { name, render, description };
}
