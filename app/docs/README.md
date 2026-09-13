# CodeGraph Explorer — docs

A local, single-file HTML visualizer for a project's CodeGraph index (the
SQLite DB CodeGraph maintains at `.codegraph/codegraph.db`). Not tied to any
one repo: it walks up from wherever it's run to find the nearest
`.codegraph/`, so it works the same way against any project CodeGraph has
indexed.

Read these in order if you're picking this up cold:

1. **[ARCHITECTURE.md](./ARCHITECTURE.md)** — the two-stage pipeline (data
   export vs. app build), directory map, how a run actually works end to end.
2. **[DATA_MODEL.md](./DATA_MODEL.md)** — the exact shape of `window.__GRAPH_DATA__`,
   the thing every component reads from. Check this before touching any
   `DATA.foo[i][j]` indexing — it's all positional arrays, not objects, for
   size.
3. **[DECISIONS.md](./DECISIONS.md)** — why things are built the way they
   are, including two real bugs hit and fixed during development that are
   easy to reintroduce if you don't know the history.

For end users annotating their own codebase to get better Domain View
grouping, see **[../../docs/domain-tagging.md](../../docs/domain-tagging.md)**
— the `@domain`/`@flow` docstring tag format, plus an LLM prompt to auto-tag
a codebase.

## Where the actual tool lives

- `~/.codegraph-viz-tool/generate.mjs` — the CLI entry point. Exports fresh
  data from a project's CodeGraph DB and writes `<project>/.codegraph/viz/index.html`.
- `~/.codegraph-viz-tool/app/` — this Svelte project. `npm run build` here
  produces `dist/index.html`, a single-file bundle that `generate.mjs` reads
  as a template and injects data into. **This directory's build output is
  the thing `generate.mjs` depends on — always rebuild after editing `src/`.**
- A `codegraph:view` shell alias (in the user's `~/.zshrc`) runs
  `generate.mjs` and opens the result. It does **not** rebuild the Svelte
  app — see ARCHITECTURE.md for why that's a deliberate two-speed split.

## Quick orientation for a code change

- Adding a UI feature / view → edit `app/src/lib/*.svelte`, `stores.js`,
  `actions.js` → `cd app && npm run build` → regenerate → open.
- Changing what data gets exported (new fields, new edge kinds, different
  filtering) → edit `generate.mjs` only; no app rebuild needed, just
  regenerate.
- Changing the DATA schema shape → touch **both**: the export in
  `generate.mjs` and the reader in `app/src/lib/graph.js` (`loadGraphData`'s
  sample fallback + the shape comment), then everywhere that indexes into
  the changed array. Update DATA_MODEL.md too.

## Testing

There's no permanent test suite (it's a personal dev tool, not shipped
code). The pattern used throughout development: write a throwaway
Playwright script against the *generated* `.codegraph/viz/index.html`
(headless Chromium, `page.on('pageerror', ...)` to catch real JS errors),
run it from this repo's `playwright/` package (it already has Playwright
installed), then delete the script once it passes. See DECISIONS.md for two
bugs that were only caught this way — visual "looks fine" checks missed
both.
