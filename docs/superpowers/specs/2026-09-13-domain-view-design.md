# Domain View Design

## Goal

Add a structural, no-LLM "domain view" to codegraph-viz that groups a
codebase into coarse business/feature areas (approximating what tools like
understand-anything derive with an LLM), and shows the entry points and
short call-chain previews within each — entirely from data codegraph-viz
already exports, with zero new export-time computation, zero network/LLM
calls, and zero new npm dependencies.

## Context

This follows two prior conversations: a UI sketch (an Artifact mockup,
approved) demonstrating the intended look, and a design Q&A that resolved
the open questions below. It also follows a repo-wide docstring sweep
(separate, already-merged work) establishing that CodeGraph's indexer
extracts one-line doc comments for **functions**, but not for
Svelte-component-level summaries — relevant here because domain/entry-point
descriptions in this feature come from function docstrings where present,
not from any new synthesized text.

An existing-views survey (done before this design) confirmed no current
view already does "group by package, show entry points, preview call
chains within" — the closest analogs are `DocsView.svelte` (package
grouping shell), `EntryPointsView.svelte`/`RoutesView.svelte` (entry-point
detection, ungrouped), and `FlowView.svelte`/`AllFlowsView.svelte` (call
chain rendering, single-root-driven). This feature combines pieces of all
three without duplicating their logic.

## Non-goals

- No LLM-authored domain names or narrative step descriptions (see prior
  conversation: this is the explicit, agreed tradeoff of staying static).
- No new export-time computation in `lib/graph.mjs` / `bin/codegraph-viz.js`
  — this feature is 100% derivable from data already in `window.__GRAPH_DATA__`.
- No framework-specific module detection (e.g. NestJS `@Module()`
  decorators) — folder-depth grouping only (resolved design question).
- No full inline tree/canvas rendering inside the domain view itself —
  deep exploration hands off to the existing `FlowView`.

## Architecture

Purely a new client-side Svelte view plus a handful of pure helper
functions in `app/src/lib/graph.js`. No changes to the export pipeline
(`lib/graph.mjs`, `bin/codegraph-viz.js`), no new data fields baked into
the exported HTML.

### Data model / pure functions (`app/src/lib/graph.js`)

- **`groupPackagesByDepth(packages, depth)`** → `Map<string, number[]>`
  (domain name → package indices). `packages` is the existing
  `DATA.packages` array (`[name, fileCount, symbolCount][]`, per the doc
  comment at `app/src/lib/graph.js:36`). Truncates each package's `/`-
  separated path to `depth` segments and groups package indices under that
  prefix. E.g. at depth 2, `app/src/lib` and `app/src/components` both
  group under `app/src`; a package shorter than `depth` segments groups
  under its own full name. Pure string/array logic — no new data needed.

- **Entry-point detection**: no new function — reuses the existing
  `isEntryPoint(sym, snippet, callerCount)` (`app/src/lib/graph.js:666`)
  verbatim, called per-symbol for symbols whose file's package index is in
  a given domain's package-index set. This is the same heuristic already
  powering `EntryPointsView.svelte` and `RoutesView.svelte` — no new
  detection logic, no risk of the two views disagreeing on what counts as
  an entry point.

- **`previewChain(rootId, symOutAdj, maxHops)`** → `number[]` (ordered
  symIds, inclusive of `rootId`). A short, deliberately **linear** (not
  branching) greedy walk: from `rootId`, repeatedly follow the first
  outgoing edge in `symOutAdj.get(id)` (the same adjacency shape
  `buildAdjacency` already produces, consumed elsewhere via
  `symOutAdj`/`symInAdj` in `stores.js`), stopping at `maxHops` steps, at a
  node with no outgoing edges, or upon revisiting an already-visited symId
  (cycle guard — belt-and-suspenders alongside the hop cap, which alone
  already bounds the walk regardless of cycles). This is intentionally NOT
  `buildFlowTree` — that produces a full branching tree for `FlowView`'s
  D3 rendering; this produces a single flat preview path matching the
  linear-chain look already approved in the UI sketch. Default
  `maxHops = 4`.

### New store (`app/src/lib/stores.js`)

- **`domainDepth`** — writable number, default `2`. Ephemeral (NOT
  persisted to `localStorage`, unlike `detailMode`): this is an
  exploratory dial a user re-adjusts per repo/session, not a stable
  reading preference. Reset story: no explicit reset needed since it's
  never cleared mid-session by anything other than the user's own stepper
  clicks — same "who resets this" bar the plan's other stores meet, just
  answered as "nothing needs to, it's session-local and harmless at any
  value."

### New view (`app/src/lib/DomainView.svelte`)

- New `view` value: `'domains'`. Wired into `App.svelte`'s existing flat
  `{#if $view === '...'}` chain (see the existing-views survey: this is
  the established pattern for `deadCode`, `hubs`, `entryPoints`,
  `pkgSummary`, `routes`, `structure`, `docs`, `indexHealth` — `domains`
  joins that list, not a new navigation paradigm).
- New toggle button in `Sidebar.svelte`, alongside the other analysis-view
  toggles, following their existing "click to open, click again to return
  to `packages`" pattern.
- **Layout** (matches the approved sketch): a domain rail on the left
  (list of domains at the current `domainDepth`, each showing its package
  count), a depth stepper control at the top of the rail, a center pane
  listing the selected domain's entry points — each with its
  `previewChain` rendered as a small vertical step list (numbered badges,
  package-color dot, symbol name + kind + file, connector arrows) reusing
  the same visual language as the redesigned `PathFinderModal` chain — and
  the existing `DetailPanel` on the right, unchanged (it already renders
  whatever symbol is selected via `selectedSymbol`, no modification
  needed).
- **Interaction**: clicking any step in a preview chain calls
  `selectSymbol` (existing, `actions.js`) to populate `DetailPanel`;
  clicking an entry point's name/header opens the existing `FlowView`
  rooted there via the existing `openFlow`-style action in `actions.js`
  (exact call site TBD against `actions.js`'s real current signature at
  implementation time — the plan's Task 1 brief should have the
  implementer confirm it, same pattern this plan's other tasks have used
  for open questions).
- Reuses `EntryPointsView`'s existing filter pattern (free-text + kind
  chips) for domains with many entry points, rather than new pagination.

## Edge cases

- **Domain with zero entry points**: shown in the rail (not hidden), with
  an empty-state message in the center pane ("No entry points detected in
  this domain") — keeps the domain list structurally honest.
- **Entry point with no callees**: `previewChain` returns `[rootId]` only;
  rendered as a single step, no dangling connector arrow.
- **Cyclic call graphs**: `previewChain`'s hop cap bounds the walk
  regardless of cycles; the visited-set cycle guard is redundant but
  cheap and clarifies intent.
- **`domainDepth` deeper than the repo's real nesting**: grouping just
  degrades naturally — multiple requested "domains" resolve to the same
  package, or map 1:1 with leaf packages at high depth. No special-casing.
- **Very large domains**: bounded by the existing filter pattern (reused,
  not reinvented) rather than a new cap/pagination mechanism.

## Testing

- **Pure functions** (`groupPackagesByDepth`, `previewChain`): plain-Node
  `assert` tests added to `test/graph-client-smoke.js`, same style as the
  existing `shortestPath`/`blastRadius` tests (fixed fixture graph,
  asserted shape).
- **`DomainView.svelte`**: no automated test harness, matching this
  project's established convention for `.svelte` files — verified via
  `cd app && npx vite build` (must succeed, no new warnings beyond the 4
  already-accepted `Modal.svelte` a11y warnings) plus a manual dev-server
  check described in the implementation plan.
- **No changes** to `lib/graph.mjs`, `bin/codegraph-viz.js`, or
  `test/smoke.js` — this feature touches zero export-time code.

## File structure

New files:
- `app/src/lib/DomainView.svelte` — the new view.

Modified files:
- `app/src/lib/graph.js` — add `groupPackagesByDepth()`, `previewChain()`.
- `app/src/lib/stores.js` — add `domainDepth` writable.
- `app/src/lib/Sidebar.svelte` — add the `'domains'` toggle button.
- `app/src/App.svelte` — add the `{#if $view === 'domains'}` branch.
- `test/graph-client-smoke.js` — add assertions for the two new pure
  functions.

## Self-review notes

- **Placeholder scan**: no TBDs except one explicitly flagged item (the
  exact `actions.js` call site for "open FlowView rooted at this entry
  point") — flagged, not hidden, and following this plan's own established
  pattern (several earlier tasks in this repo's history flagged similar
  "confirm against real code" items rather than guessing).
- **Internal consistency**: entry-point detection deliberately reuses
  `isEntryPoint()` verbatim rather than introducing a second heuristic —
  checked against `EntryPointsView.svelte`'s/`RoutesView.svelte`'s usage
  during the existing-views survey.
- **Scope check**: single cohesive feature, no sub-decomposition needed —
  one implementation plan.
- **Ambiguity check**: `previewChain`'s "linear, not branching" behavior
  was the one place two readings were possible (a shallow branching tree
  vs. a single greedy path); resolved explicitly in favor of a single
  linear path, matching the already-approved UI sketch's visual, and
  because full branching exploration is `FlowView`'s job per the resolved
  "list + preview + handoff" design decision.
