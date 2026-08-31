"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FrameView } from "./frame-view";
import { parseManifest } from "./parse-manifest";
import type { NewTicketInput, SaveFlowInput, SaveFlowResult, TicketSummary } from "./pin";
import type { RegistryEntry } from "./registry";
import type { CreateResult } from "./ticket-drawer";
import { WorkbenchApp, type WorkbenchView } from "./workbench-app";

/**
 * The host's mount point — a **client** entry, and that is not a style choice.
 *
 * The generated registry is a list of `() => import("…")` thunks, because a
 * lazy import needs a static specifier for the bundler to split on. Functions
 * cannot cross the server-to-client boundary, so a server page that received
 * the registry and passed it down fails at runtime with "Functions cannot be
 * passed directly to Client Components" — measured, on the first render.
 *
 * So the boundary is crossed *above* the registry: the host's page is a client
 * component that imports the registry directly, and the only things that travel
 * from the server are the Server Actions, which are designed to.
 *
 * `workbench init` writes the two host files this needs:
 *
 *   // app/workbench/page.tsx        — a SERVER component: notFound() gates
 *   // the route off production, which a client page cannot do.
 *   import { notFound } from "next/navigation";
 *   import { WorkbenchMount } from "./mount";
 *   export default function Page() {
 *     if (process.env.NODE_ENV === "production" && process.env.VERCEL_ENV !== "preview") {
 *       notFound();
 *     }
 *     return <WorkbenchMount />;
 *   }
 *
 *   // app/workbench/mount.tsx       — "use client", holds the registry
 *   import { WorkbenchClient } from "@open-flow/ui/app";
 *   import { createTicket, loadTickets, saveFlow } from "@open-flow/ui/actions";
 *   import manifest from "../../../.workbench/manifest.json";
 *   import { registry } from "../../../.workbench/registry";
 *   export function WorkbenchMount() { … }
 *
 * The actions come from the package's `./actions` export behind the
 * `development` condition — the host writes no "use server" file of its own.
 */
export interface WorkbenchClientProps {
	/** The imported `.workbench/manifest.json`. Checked, not assumed. */
	manifest: unknown;
	/** The generated `.workbench/registry`, imported by the host. */
	registry: RegistryEntry[];
	onCreateTicket: (input: NewTicketInput) => Promise<CreateResult>;
	/** A Server Action. Omit it and the Superficies tab simply lists no tickets. */
	onLoadTickets?: () => Promise<TicketSummary[]>;
	/** A Server Action. Omit it and Flujos is read-only: no «+ Añadir
	 *  pantalla», no connect gesture, no «Añadir recorrido». */
	onSaveFlow?: (input: SaveFlowInput) => Promise<SaveFlowResult>;
}

export function WorkbenchClient(props: WorkbenchClientProps) {
	// `useSearchParams` suspends during static rendering; without this boundary
	// Next refuses to build the page at all.
	return (
		<Suspense fallback={null}>
			<Inner {...props} />
		</Suspense>
	);
}

function toView(params: URLSearchParams): WorkbenchView {
	const read = (key: string) => params.get(key) ?? undefined;
	return {
		tab: read("tab"),
		component: read("component"),
		flow: read("flow"),
		surface: read("surface"),
		vp: read("vp"),
		zoom: read("zoom"),
		theme: read("theme"),
		chrome: read("chrome"),
	};
}

function Inner({
	manifest: raw,
	registry,
	onCreateTicket,
	onLoadTickets,
	onSaveFlow,
}: WorkbenchClientProps) {
	const params = useSearchParams();
	const [tickets, setTickets] = useState<TicketSummary[]>([]);
	// The manifest never changes within a session; re-walking a 393 KB object
	// graph on every keystroke-triggered render is pure churn.
	const manifest = useMemo(() => parseManifest(raw), [raw]);

	useEffect(() => {
		if (!onLoadTickets) return;
		let live = true;
		// A missing binary or an empty tickets directory is not an error worth
		// showing here; the action already answers with an empty list.
		void onLoadTickets().then((loaded) => {
			if (live) setTickets(loaded);
		});
		return () => {
			live = false;
		};
	}, [onLoadTickets]);

	// The isolated single-screen view is the same route with different
	// parameters, so a host that mounts one path gets both.
	const route = params.get("route") ?? undefined;
	if (params.get("view") === "frame" || route) {
		return (
			<FrameView
				manifest={manifest}
				registry={registry}
				componentId={params.get("component") ?? undefined}
				route={route}
				viewport={params.get("viewport") ?? undefined}
				theme={params.get("theme") ?? undefined}
				scenario={params.get("scenario") ?? undefined}
			/>
		);
	}

	return (
		<WorkbenchApp
			manifest={manifest}
			registry={registry}
			tickets={tickets}
			view={toView(params)}
			onCreateTicket={onCreateTicket}
			onSaveFlow={onSaveFlow}
		/>
	);
}
