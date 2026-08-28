"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { cx } from "./cx";
import { useInspect } from "./edit-mode";
import { EditSessionOverlay, useEditSession } from "./edit-session";
import { buildComponentIndex } from "./hover-inspect";
import { surfaceForRoute } from "./manifest";
import { parseOverlayManifest } from "./parse-manifest";
import { BOX_ATTR } from "./pick-box";
import { createTicket } from "./dev-actions";
import type { NewTicketInput } from "./pin";
import { TicketDrawer, type CreateResult } from "./ticket-drawer";

/**
 * Pick on any page: ⌥P.
 *
 * Mounted from the host's root layout, so every real route gets a **Señalar**
 * pill. Arm it, hover, click: the pin carries what you pointed at, you type what
 * should change, and the ticket is written.
 *
 * Two things it refuses to run inside, for the same reason:
 *
 * - the workbench's own mount path, which has its own edit mode
 * - **any iframe**, because a flow storyboard renders real routes in frames and
 *   this overlay would mount inside each of them — two pickers over one
 *   document is how the tool ends up pointing at itself
 *
 * What resolution can honestly tell you here is less than in the workbench, and
 * the label says so: most of an App Router app is server-rendered, and a Server
 * Component has **no client fiber**, so the answer is the tag plus the surface
 * the route mounts. That is the whole truth available, and it is still enough
 * to open a ticket against the right files.
 */
export function WorkbenchOverlay({
	manifest: raw,
	onCreateTicket = createTicket,
}: {
	/** The imported `.workbench/overlay.json` — the trimmed slice, checked here. */
	manifest: unknown;
	/**
	 * Defaults to this package's own action. Supply one only to route tickets
	 * somewhere else — the default is what keeps the host's layout to a single
	 * line and, more importantly, keeps the host from importing an action module
	 * that a production build would then register on every route.
	 */
	onCreateTicket?: (input: NewTicketInput) => Promise<CreateResult>;
}) {
	// Memoized with intent: the overlay renders on every route AND inside every
	// flow iframe's document, so an unmemoized parse plus a rebuilt component
	// index ran once per render times N live documents — churn the 7 GB
	// dev-server investigation caught. Pattern as in workbench-app.tsx.
	const manifest = useMemo(() => parseOverlayManifest(raw), [raw]);
	const pathname = usePathname();
	const session = useEditSession();
	const [armed, setArmed] = useState(false);

	// `window.self !== window.top` read through a store rather than in render:
	// it is a browser fact, and reading it during render would differ between
	// the server pass and the first client pass.
	const inFrame = useSyncExternalStore(
		() => () => {},
		() => window.self !== window.top,
		() => false,
	);
	const suppressed = pathname.startsWith(manifest.config.mountPath) || inFrame;

	const componentIndex = useMemo(
		() => buildComponentIndex(manifest.components),
		[manifest.components],
	);
	const routeSurface = useMemo(
		() => surfaceForRoute(manifest.routes, pathname),
		[manifest.routes, pathname],
	);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			// ⌥P rather than a bare letter: this runs on real pages, where every
			// keystroke might belong to a form the user is filling in.
			if (event.altKey && (event.key === "p" || event.key === "π")) {
				event.preventDefault();
				setArmed((current) => !current);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	// The whole document is app content out here, so the box is the body.
	useEffect(() => {
		if (suppressed) return;
		const attribute = BOX_ATTR;
		if (session.editing) document.body.setAttribute(attribute, "");
		else document.body.removeAttribute(attribute);
		return () => document.body.removeAttribute(attribute);
	}, [session.editing, suppressed]);

	useInspect(
		session.editing && !suppressed,
		// The page itself, not this overlay's own markup.
		useCallback(() => document.body, []),
		componentIndex,
		{
			onPin: (pin) =>
				session.addPin({
					...pin,
					// A server-rendered element has no component, but the route
					// still names a surface — so the pin is still a coordinate.
					node:
						pin.node ??
						(routeSurface ? { component: "", file: null, surface: routeSurface } : null),
				}),
			onHover: (target) =>
				session.setHovering(
					target && {
						...target,
						node: { ...target.node, surface: target.node.surface ?? routeSurface },
					},
				),
		},
		pathname,
	);

	if (suppressed || (!armed && !session.editing)) {
		return suppressed ? null : (
			<button
				type="button"
				onClick={() => setArmed(true)}
				data-workbench-live=""
				className="fixed bottom-4 right-4 z-[2147483000] rounded-full bg-zinc-900/80 px-3 py-1.5 text-[11px] font-medium text-white shadow-lg backdrop-blur hover:bg-zinc-900 dark:bg-zinc-100/80 dark:text-zinc-900"
				title="Señalar un elemento (⌥P)"
			>
				Señalar
			</button>
		);
	}

	return (
		<div data-workbench-live="">
			<div className="fixed bottom-4 right-4 z-[2147483000] flex items-center gap-2 rounded-full bg-zinc-900/90 px-2 py-1.5 text-[11px] text-white shadow-lg backdrop-blur dark:bg-zinc-100/90 dark:text-zinc-900">
				<button
					type="button"
					onClick={session.toggleEditing}
					className={cx(
						"rounded-full px-2 py-0.5 font-medium",
						session.editing ? "bg-amber-400 text-amber-950" : "hover:bg-white/10",
					)}
				>
					{session.editing ? "Señalando ●" : "Señalar"}
				</button>
				<button
					type="button"
					onClick={session.openDrawer}
					className="rounded-full px-2 py-0.5 hover:bg-white/10"
				>
					Solicitud{session.pins.length > 0 ? ` (${session.pins.length})` : ""}
				</button>
				<button
					type="button"
					onClick={() => setArmed(false)}
					className="rounded-full px-1.5 py-0.5 opacity-60 hover:opacity-100"
					title="Ocultar (⌥P)"
				>
					×
				</button>
			</div>

			<EditSessionOverlay session={session} />
			<TicketDrawer
				session={session}
				surfaces={manifest.surfaces}
				route={pathname}
				onCreate={onCreateTicket}
			/>
		</div>
	);
}
