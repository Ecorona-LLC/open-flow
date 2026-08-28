"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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

/** Measure a container and resolve the requested zoom into a real scale. */
export function useScale(zoom: Zoom, naturalWidth: number, gutters: number) {
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

	const scale = zoom === "fit" ? fitScale(available, naturalWidth, gutters) : zoom;
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
}: {
	viewport: Viewport;
	scale: number;
	label?: ReactNode;
	children: ReactNode;
	/** Arms picking on the screen itself — never on this frame's chrome. */
	editing?: boolean;
}) {
	// The column is the scaled frame plus the shell's own padding. Without a
	// bound the header text sets the min-width — a 390px phone at 33% is 128px
	// wide, its label needs ~250px, and four of those overflowed a board that
	// was supposed to fit.
	//
	// Floored, not rounded: four columns each rounding up by a fraction of a
	// pixel is enough to push a board that should fit into a scrollbar.
	const framed = Math.floor(viewport.width * scale);
	const framedHeight = Math.floor(viewport.height * scale);

	return (
		<div style={{ width: framed + FRAME_CHROME }}>
			<FrameShell
				label={label}
				meta={`${viewport.width}×${viewport.height} · ${Math.round(scale * 100)}%`}
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
