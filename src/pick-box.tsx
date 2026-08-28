"use client";

import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * The pickable region: the rendered product, never the tool around it.
 *
 * This lives in its own leaf module, and — more importantly — it is applied by
 * the two components that actually render a screen (`ScreenFrame` and
 * `InlineSurface`), not by their callers. When each panel placed its own box,
 * they placed it differently: the component panel wrapped the content *inside*
 * the frame, while the isolated viewer wrapped the whole `ScreenFrame`, so its
 * header and padding were pickable and hovering the wrapper reported `<div>`.
 * A rule every caller has to remember is a rule that gets it wrong.
 */
export const BOX_ATTR = "data-workbench-box";

export function PickBox({
	enabled,
	children,
	className,
}: {
	enabled?: boolean;
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			{...(enabled ? { [BOX_ATTR]: "" } : {})}
			className={cx(className, enabled && "cursor-crosshair ring-2 ring-amber-400 ring-inset")}
		>
			{children}
		</div>
	);
}
