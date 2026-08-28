/**
 * The production overlay: nothing.
 *
 * `package.json` maps `./overlay` to this file under the `default` export
 * condition and to the real one under `development`, so a production bundle
 * resolves the stub and the picker never reaches it — not merely unrendered,
 * but absent from the module graph.
 *
 * That distinction is the whole reason this file exists. A `NODE_ENV` check at
 * the call site removes the overlay from the *render* path while the import
 * keeps it in the *graph*, and a production build then carried the picker, a
 * POST-able ticket-writing Server Action, and a 50 KB index naming 556 source
 * files into the client bundle. The host repo needed three stub files and a
 * bundler alias to undo that; an export condition does it once, here.
 *
 * Verify after changing, on a real production build of a host app — both must
 * come back empty:
 *
 *   grep -rl "data-workbench-live" .next/static
 *   grep -c  "workbench" .next/server/server-reference-manifest.json
 */
export function WorkbenchOverlay(_props: { manifest?: unknown; onCreateTicket?: unknown }): null {
	return null;
}
