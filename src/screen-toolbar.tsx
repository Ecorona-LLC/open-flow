"use client";

import type { ReactNode } from "react";
import { useViewerConfig } from "./config-context";
import { cx } from "./cx";
import { workbenchUrl } from "./manifest";
import type { Zoom } from "./screen-frame";

/**
 * The one toolbar. Componentes and Flujos render this and nothing else.
 *
 * They used to carry different controls in different vocabularies — one spoke
 * viewports, the other spoke "Compacto / Cómodo / Grande" column widths, which
 * are unrelated to a frame's width and so behaved oppositely on the two panels.
 * Same control row now, same labels, same meaning; anything a single panel
 * needs goes in the `actions` slot rather than growing a second toolbar.
 *
 * It also carries the actions that act on what is displayed — edit mode and
 * "abrir aislado". Those used to sit in the left rail, which is navigation
 * (which component, which flow, which surface), not verbs about the current view.
 */
/**
 * The small bordered action button this toolbar established. Exported so the
 * flow board's frame controls stay visually siblings — the same string copied
 * into three files is exactly the drift this package exists to remove.
 */
export const CHIP =
	"rounded-md border border-zinc-300 px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

export const AUTO = "auto";

export type ThemeMode = "light" | "dark" | "split";

/** The only segmented control in the package. */
export function SegmentedControl<T extends string | number>({
	options,
	value,
	onChange,
	disabled = false,
	disabledReason,
}: {
	options: Array<{ id: T; label: string; note?: string | null }>;
	value: T;
	onChange: (next: T) => void;
	disabled?: boolean;
	disabledReason?: string;
}) {
	return (
		<div
			className={cx(
				"flex rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700",
				disabled && "opacity-40",
			)}
			title={disabled ? disabledReason : undefined}
		>
			{options.map((option) => (
				<button
					key={String(option.id)}
					type="button"
					// `aria-disabled`, not `disabled`: the REASON is the point, and
					// a tooltip on an unfocusable control reaches nobody — the same
					// rule the board's blocked «quitar» chip follows.
					aria-disabled={disabled || undefined}
					onClick={disabled ? undefined : () => onChange(option.id)}
					title={disabled ? disabledReason : (option.note ?? undefined)}
					className={cx(
						"rounded px-2 py-1 text-[11px] font-medium transition-colors",
						option.id === value
							? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
							: "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
					)}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

/** A control and what axis it moves, so three pill rows are not a guess. */
function Labelled({ label, children }: { label: string; children: ReactNode }) {
	return (
		<span className="flex items-center gap-1.5">
			<span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
				{label}
			</span>
			{children}
		</span>
	);
}

const ZOOMS: Array<{ id: Zoom; label: string }> = [
	{ id: "fit", label: "Ajustar" },
	{ id: 0.5, label: "50%" },
	{ id: 0.75, label: "75%" },
	{ id: 1, label: "100%" },
];

const THEMES: Array<{ id: ThemeMode; label: string }> = [
	{ id: "light", label: "Claro" },
	{ id: "dark", label: "Oscuro" },
	{ id: "split", label: "Ambos" },
];

export function ScreenToolbar({
	viewport,
	onViewport,
	zoom,
	onZoom,
	theme,
	onTheme,
	hint,
	zoomDisabledReason,
	actions,
	identity,
	backHref,
	zoomEnabled = true,
	editing,
	onToggleEdit,
	pinCount,
	onOpenRequest,
	isolatedBase,
}: {
	/** `AUTO`, or a viewport id from the manifest. */
	viewport: string;
	onViewport: (next: string) => void;
	/** Absent together: the panel has no preset zoom (the flow canvas zooms
	 *  itself), the control shows «Ajustar» disabled, and the isolated URL
	 *  carries no `zoom`. */
	zoom?: Zoom;
	onZoom?: (next: Zoom) => void;
	theme: ThemeMode;
	onTheme: (next: ThemeMode) => void;
	hint?: ReactNode;
	/**
	 * Why the zoom presets cannot act. The control keeps its slot — the row is
	 * identical on every panel — but says so: Flujos' canvas has its own zoom,
	 * and on Componentes in Auto there is no frame to scale.
	 */
	zoomDisabledReason?: string;
	/** Panel-specific actions — e.g. "Recargar cuadros" on Flujos. */
	actions?: ReactNode;
	/**
	 * What you are looking at, as a chip. On the isolated viewer this used to be
	 * the `hint`, which spent a whole row on the single character "/".
	 */
	identity?: ReactNode;
	/** Shown when there is somewhere to go back to — the isolated viewer. */
	backHref?: string;
	/**
	 * Componentes in Auto renders inline, so there is no frame to scale. The
	 * control still occupies its slot — the row is identical on both panels —
	 * but says why it cannot act instead of vanishing.
	 */
	zoomEnabled?: boolean;
	/**
	 * Pick mode. Owned by the app, because the ticket drawer is app-level — so
	 * the isolated single-screen viewer, which has no drawer, omits these and
	 * the group simply does not render.
	 */
	editing?: boolean;
	onToggleEdit?: () => void;
	pinCount?: number;
	onOpenRequest?: () => void;
	/**
	 * What identifies the current view — `{ tab, component }` or `{ tab, flow }`.
	 * The toolbar appends the display state it already holds, so the isolated
	 * page opens as exactly what you were looking at.
	 */
	isolatedBase?: Record<string, string>;
}) {
	const config = useViewerConfig();
	const isolated = isolatedBase
		? workbenchUrl(
				config,
				"",
				new URLSearchParams({
					...isolatedBase,
					vp: viewport,
					// No `zoom` when the panel has none: the isolated canvas
					// opens at fit, which is the only zoom it understands.
					...(zoom === undefined ? {} : { zoom: String(zoom) }),
					theme,
					chrome: "off",
				}),
			)
		: null;

	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-200 bg-white px-6 py-2 dark:border-zinc-700 dark:bg-zinc-900">
			{backHref && (
				<a
					href={backHref}
					className="rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
				>
					← Open-Flow
				</a>
			)}
			{identity && (
				<span className="max-w-[16rem] truncate rounded bg-zinc-100 px-2 py-1 font-mono text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
					{identity}
				</span>
			)}
			{/* Options come from the manifest's viewports, so adding the sm (640)
			    or lg (1024) boundary later is a config edit, not a code change. */}
			<Labelled label="Tamaño">
				<SegmentedControl<string>
					value={viewport}
					onChange={onViewport}
					options={[
						{ id: AUTO, label: "Auto" },
						...config.viewports.map((option) => ({
							id: option.id,
							label: option.label,
							note: option.note,
						})),
					]}
				/>
			</Labelled>
			<Labelled label="Zoom">
				<SegmentedControl<Zoom>
					value={zoom ?? "fit"}
					onChange={onZoom ?? (() => {})}
					options={ZOOMS}
					disabled={!zoomEnabled || onZoom === undefined}
					disabledReason={
						zoomDisabledReason ??
						"En Auto el componente se dibuja en línea, sin cuadro que escalar."
					}
				/>
			</Labelled>
			<Labelled label="Tema">
				<SegmentedControl<ThemeMode> value={theme} onChange={onTheme} options={THEMES} />
			</Labelled>
			{actions}

			<span className="ml-auto flex items-center gap-2">
				{onToggleEdit && (
					<button
						type="button"
						onClick={onToggleEdit}
						className={cx(
							"rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
							editing
								? "bg-amber-400 text-amber-950"
								: "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800",
						)}
						title="Señalar elementos (E)"
					>
						{editing ? "Editando ●" : "Editar"}
					</button>
				)}
				{onOpenRequest && (
					<button type="button" onClick={onOpenRequest} className={CHIP}>
						Solicitud{(pinCount ?? 0) > 0 ? ` (${pinCount})` : ""}
					</button>
				)}
				{isolated && (
					<a
						href={isolated}
						target="_blank"
						rel="noreferrer"
						className={CHIP}
						title="Sin cromo, en una pestaña nueva"
					>
						Abrir aislado ↗
					</a>
				)}
			</span>

			{hint && (
				<p className="basis-full text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
					{hint}
				</p>
			)}
		</div>
	);
}
