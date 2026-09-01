"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { EDGE_VAR, ZOOM_VAR } from "./canvas-gestures";
import { FrameShell } from "./frame";
import type { Viewport } from "./manifest.types";
import { PickBox } from "./pick-box";

/**
 * One way to show a screen, for both the flow storyboard and the component
 * device previews.
 *
 * Three things used to derive the same number independently: a `useFitScale`
 * inside the frame, `mapRect` from `frameRect.width / offsetWidth`, and a
 * `COLUMN_WIDTHS` table as an implicit third. Column width and frame width are
 * unrelated quantities, so one control gave opposite results on the two panels
 * — a 680px column on a 390px phone frame meant scale 1, a 460px column on a
 * 1280px desktop frame meant 0.36 and still clipped.
 *
 * Now the **board** measures and owns one scale; `ScreenFrame` only renders,
 * and stamps that scale where the pick overlay reads it back.
 */
export const SCALE_ATTR = "data-workbench-scale";

/** Explicit zoom, or `fit` — the scale that makes everything visible at once. */
export type Zoom = "fit" | 0.5 | 0.75 | 1;

const MIN_SCALE = 0.15;

/**
 * Layout overhead that does NOT scale with the frames, in laid-out pixels.
 * These must track the CSS below, or `fit` overshoots: a first pass counted
 * only the gaps and left the board 80px wider than its container.
 */
/** `p-3` on both sides of the frame inside its shell. */
export const FRAME_CHROME = 24;
/** Two `gap-4`s plus the arrow column between two steps. */
export const STEP_GUTTER = 50;
/**
 * A few pixels of headroom. The constants above approximate real CSS and can
 * never be exact — borders, sub-pixel rounding, a slightly different arrow
 * glyph. Being a hair too small is invisible; being a hair too large is a
 * scrollbar on a board whose whole promise is that it fits. Measured overshoots
 * of 1px and 8px are why this is 8 and not 1.
 */
const FIT_SLACK = 8;

/**
 * The scale that fits `naturalWidth` into the measured container.
 *
 * `naturalWidth` is a **sum**, not a count times one width: under Auto a flow
 * can be three phone screens and one desktop one, so anything assuming a
 * uniform frame sizes it wrong.
 */
export function fitScale(available: number, naturalWidth: number, gutters: number): number {
	if (naturalWidth <= 0) return 1;
	const usable = available - gutters - FIT_SLACK;
	if (usable <= 0) return MIN_SCALE;
	return Math.min(1, Math.max(MIN_SCALE, usable / naturalWidth));
}

/**
 * What a row of screens asks of its container before any scale: the frame
 * widths, which scale, and the chrome and gutters between them, which do not.
 */
export interface RowExtent {
	natural: number;
	gutters: number;
}

/** A row's extent from the natural widths of its frames, left to right. */
export function rowExtent(widths: readonly number[]): RowExtent {
	return {
		natural: widths.reduce((total, width) => total + width, 0),
		gutters: widths.length * FRAME_CHROME + Math.max(0, widths.length - 1) * STEP_GUTTER,
	};
}

/**
 * The size a frame draws at. Floored, not rounded: four columns each rounding
 * up by a fraction of a pixel is enough to push a board that should fit into
 * a scrollbar.
 */
export function framedWidth(width: number, scale: number): number {
	return Math.floor(width * scale);
}

/**
 * One column as the board lays it out: the framed screen plus the shell's own
 * padding. `ScreenFrame` draws exactly this and the Flujos board offsets a
 * branch row by a sum of these — one owner, or a fork row drifts off the
 * column it claims to continue from the day either side changes its rounding.
 */
export function columnWidth(width: number, scale: number): number {
	return framedWidth(width, scale) + FRAME_CHROME;
}

/**
 * The scale that fits EVERY row. Not "fit the widest row": gutters do not
 * scale and frames do, so the row that is widest at 100% is not always the one
 * that needs the smallest scale — six phones beside a branch of two desktops
 * picked the branch, and the trunk still overflowed a 900px board by 4px.
 */
export function fitRows(available: number, rows: readonly RowExtent[]): number {
	return rows.reduce(
		(best, row) => Math.min(best, fitScale(available, row.natural, row.gutters)),
		1,
	);
}

/** Measure a container and resolve the requested zoom into a real scale. */
export function useScale(zoom: Zoom, rows: readonly RowExtent[]) {
	const ref = useRef<HTMLDivElement>(null);
	const [available, setAvailable] = useState(0);

	useEffect(() => {
		const node = ref.current;
		if (!node) return;
		const observer = new ResizeObserver((entries) => {
			setAvailable(entries[0]?.contentRect.width ?? 0);
		});
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	const scale = zoom === "fit" ? fitRows(available, rows) : zoom;
	return { ref, scale };
}

/**
 * A screen at a viewport, drawn at a scale the caller decided.
 *
 * The content renders at natural size under a transform, so the page inside
 * genuinely believes it is `viewport.width` wide and its breakpoints resolve
 * for real; only the box around it is scaled.
 */
export function ScreenFrame({
	viewport,
	scale,
	label,
	children,
	editing,
	bare = false,
}: {
	viewport: Viewport;
	scale: number;
	label?: ReactNode;
	children: ReactNode;
	/** Arms picking on the screen itself — never on this frame's chrome. */
	editing?: boolean;
	/**
	 * Drop the shell's header row entirely. The flow canvas draws a screen's
	 * name and size as constant-size chrome above it, so an in-frame header
	 * would say the same thing twice — and its `· 100%` would be a lie, since
	 * on the canvas the scale that varies is the viewport's, not the frame's.
	 */
	bare?: boolean;
}) {
	// The column is bounded to the scaled frame plus the shell's own padding.
	// Without a bound the header text sets the min-width — a 390px phone at 33%
	// is 128px wide, its label needs ~250px, and four of those overflowed a
	// board that was supposed to fit.
	const framed = framedWidth(viewport.width, scale);
	const framedHeight = framedWidth(viewport.height, scale);

	return (
		<div
			// An inline style, not an arbitrary Tailwind class: every sibling
			// variable is set this way, and a class only exists if the HOST's
			// Tailwind scanned `dist/`. The failure would be silent — the
			// fallback is a world pixel, and the board goes back to reading as
			// flat rectangles, which is the bug this exists to fix.
			style={
				{
					width: columnWidth(viewport.width, scale),
					[EDGE_VAR]: `calc(1px / var(${ZOOM_VAR}, 1))`,
				} as React.CSSProperties
			}
		>
			<FrameShell
				label={bare ? undefined : label}
				meta={
					bare ? undefined : `${viewport.width}×${viewport.height} · ${Math.round(scale * 100)}%`
				}
			>
				<div className="bg-zinc-100 p-3 dark:bg-zinc-800">
					<PickBox enabled={editing}>
						<div
							// Read back by `mapRect`, so the pick outline cannot
							// disagree with what actually drew the frame.
							{...{ [SCALE_ATTR]: String(scale) }}
							className="relative overflow-hidden"
							style={{ width: framed, height: framedHeight }}
						>
							<div
								className="absolute left-0 top-0"
								style={{
									width: viewport.width,
									height: viewport.height,
									transform: `scale(${scale})`,
									transformOrigin: "top left",
								}}
							>
								{children}
							</div>
						</div>
					</PickBox>
				</div>
			</FrameShell>
		</div>
	);
}
