/**
 * Join class names, dropping anything falsy.
 *
 * Deliberately not `clsx` or `class-variance-authority`. The isolation contract
 * that makes this package installable anywhere is that its hand-written modules
 * import only React, a handful of Next entry points, node builtins and each
 * other — so a four-line helper beats a dependency the host would also have to
 * resolve.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
	return parts.filter(Boolean).join(" ");
}
