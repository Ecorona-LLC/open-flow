# open-flow

A live workbench over the Next.js app you already have — real components, real
design tokens, real user flows. Nothing is a copy: the viewer imports your
app's own components, so a preview and the shipped component can never drift,
because they are the same code.

```
pnpm add -D @open-flow/ui
```

Public and zero-config: any repository installs it with no tokens and no
registry setup.

## The two halves

- **`@open-flow/ui`** (this repository, open source): the complete viewer —
  design tokens, the component catalog, the flow storyboard with its live
  mirror board, named UI surfaces, the ⌥P overlay for pointing at real pages,
  and the demo-authoring API.
- **The scan engine** (private): the analyzer that reads your repository and
  produces the map this viewer renders. Distributed separately, under
  authorization from Ecorona LLC.

The viewer consumes the artifacts the engine generates (`.workbench/`); with
pre-generated artifacts, the viewer mounts on its own.

## Development

```
pnpm install
pnpm build        # tsc + minify
pnpm test         # vitest
pnpm typecheck
```

## License

Elastic License 2.0 — the source is visible and modifiable; it may not be
offered as a managed service to third parties, and the separation from the
gated engine may not be circumvented. See [LICENSE](./LICENSE).
_(Text pending legal review by Ecorona LLC.)_
