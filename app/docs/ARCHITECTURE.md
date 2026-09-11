# Architecture

## The two-stage split

There are two independent build steps, running at very different
frequencies, and this separation is the single most important thing to
understand before changing anything:

```
┌─────────────────────────┐         ┌──────────────────────────────┐
│  app/src/*.svelte, *.js  │  npm    │  app/dist/index.html          │
│  (this Svelte project)   │ ──run──▶│  (compiled, single-file       │
│                          │  build  │   bundle — no data inside)     │
└─────────────────────────┘         └───────────────┬────────────────┘
     rebuilt only when                              │ read as a template
     you change the UI                               │ by generate.mjs
                                                       ▼
┌──────────────────────────┐        ┌──────────────────────────────┐
│  <project>/.codegraph/    │  sqlite│  generate.mjs                 │
│  codegraph.db             │ ──────▶│  (exports + assembles JSON,   │
│                          │  export │   injects into the template)   │
└──────────────────────────┘        └───────────────┬────────────────┘
     changes every time                              │ writes
     CodeGraph re-indexes                            ▼
                                     <project>/.codegraph/viz/index.html
                                     (the thing you actually open)
```

`generate.mjs` runs on every `codegraph:view` invocation — it has to be
fast (sub-second), because a person is sitting there waiting to look at
fresh data. Compiling Svelte is comparatively slow and, critically, doesn't
need to happen on every view: the *UI code* doesn't change just because the
*codebase being visualized* changed. So:

- `generate.mjs` never runs `vite build`. It only does a handful of
  `sqlite3` queries, some JS array-building, and a string injection into
  the **already-built** `app/dist/index.html`.
- Whoever edits `app/src/` is responsible for running `npm run build`
  afterward. There is no watcher, no dev server wired into the normal
  workflow — this is a build-once, run-many tool.

If you make a UI change and don't see it after regenerating, this is almost
always why: you edited `src/` but didn't rebuild `dist/`.

## Data injection mechanism

`app/dist/index.html` is a normal Vite/Svelte single-file build (via
`vite-plugin-singlefile` — see `vite.config.js`). It expects
`window.__GRAPH_DATA__` to exist by the time `main.js` runs. `generate.mjs`
makes that true by inserting a small `<script>window.__GRAPH_DATA__ = {...};</script>`
directly before `</head>`, ahead of the (deferred, `type="module"`) bundle
script — see DECISIONS.md for why this specific mechanism (not a build-time
placeholder swap) and the `$&`-in-replacement-string bug that came from an
earlier, wrong version of this.

`app/src/lib/graph.js`'s `loadGraphData()` reads `window.__GRAPH_DATA__` if
present, and otherwise falls back to a small hardcoded sample dataset — that
fallback is what renders if you ever open `app/dist/index.html` directly
(e.g. via `npm run preview`) without going through `generate.mjs`. Keep it
in sync with the schema (see DATA_MODEL.md) or the dev-preview path silently
breaks.

## Directory map

```
~/.codegraph-viz-tool/
├── generate.mjs          CLI entry point (see "Pipeline" below)
└── app/                  the Svelte project
    ├── index.html         Vite entry HTML (dev-only; unrelated to dist/index.html's
    │                       runtime shape — this is the *source* Vite starts from)
    ├── vite.config.js      svelte() + viteSingleFile() plugins; cssCodeSplit
    │                        disabled so everything inlines into one file
    ├── src/
    │   ├── main.js          mounts <App/>, imports app.css
    │   ├── App.svelte        top-level layout: Header, Sidebar, one of
    │   │                      PackageView/FileView/FlowView, DetailPanel
    │   ├── app.css            all global CSS — design tokens (light/dark),
    │   │                      shared component classes. Individual .svelte
    │   │                      files add their own <style> only for things
    │   │                      specific to that component.
    │   └── lib/
    │       ├── stores.js       all Svelte writable/derived state, plus the
    │       │                    adjacency maps built once from DATA at load
    │       ├── actions.js      every state MUTATION goes through a named
    │       │                    function here — components never
    │       │                    `store.set(...)` directly for anything with
    │       │                    more than one consequence (see DECISIONS.md)
    │       ├── graph.js        pure, framework-free helpers: DATA loading,
    │       │                    adjacency building, BFS, tree building,
    │       │                    the Features/-folder grouping heuristic,
    │       │                    color/name helpers
    │       ├── Header.svelte     breadcrumb + summary stats bar
    │       ├── Sidebar.svelte    search, isolate/flow/package-focus controls,
    │       │                    package legend — the biggest file, all the
    │       │                    "control panel" UI lives here
    │       ├── PackageView.svelte  view 1: SVG force graph, one bubble per
    │       │                        package
    │       ├── FileView.svelte     view 2: canvas force graph of one
    │       │                        package's files
    │       ├── FlowView.svelte     view 3: SVG tree diagram, one function's
    │       │                        call graph, re-rootable
    │       └── DetailPanel.svelte  right-side panel: file overview OR
    │                                symbol focus (snippet + callers/callees),
    │                                mutually exclusive via selectedSymbol
    └── docs/                 you are here
```

## The three main views

`App.svelte` switches on the `view` store (`'packages' | 'files' | 'flow'`)
and renders exactly one of `PackageView` / `FileView` / `FlowView` into
`<main>`. They are **not** nested or composed — each owns its own
`<svg>`/`<canvas>`, its own d3 simulation or layout, and its own DOM
lifecycle:

- **PackageView** — always mounted fresh when you land on the packages
  view (cheap: at most a couple dozen packages). SVG + `d3-force`.
- **FileView** — remounted via `{#key $currentPkg}` in App.svelte, i.e. a
  fresh component instance per package (not per render). Canvas +
  `d3-force`, because a package can have 1000+ files and SVG doesn't scale
  to that many DOM nodes.
- **FlowView** — a single long-lived instance for the whole time
  `view === 'flow'`. Re-roots by rebuilding `treeData` reactively and
  redrawing in place — it does **not** remount, because remounting would
  lose the d3-zoom transform and defeat the "keep everything on one small
  screen" goal (see DECISIONS.md, "re-root instead of expanding depth").

## Isolate-vs-rebuild: the pattern that mattered most

The very first bug found in this tool (see DECISIONS.md) was: changing a
filter/depth control triggered a full re-layout of the force simulation,
which visually looked like "nothing happened" because the reshuffle buried
the actual (correct) change. The fix, applied consistently since, is:

> **State changes that only affect *styling* (dimming, highlighting, which
> subset is visible) must restyle the existing DOM in place. Only state
> changes that affect *which nodes exist* may rebuild the simulation/layout.**

Concretely: `PackageView`'s `applyIsolateStyle()` and `FileView`'s `draw()`
are called on every isolate/filter change without touching the simulation;
the simulation/node/link setup in each component's `onMount` only runs
once, at mount. Keep this distinction if you add new filters — a new toggle
should almost always be a restyle, not a rebuild.
