# Decisions, and the bugs that shaped them

Roughly chronological. Each entry: what was decided/found, why, and what
breaks if you undo it without knowing why it was there.

## 1. Two-speed pipeline: pre-built app + fast per-run data export

**Decision:** `generate.mjs` never invokes Vite. It reads the already-built
`app/dist/index.html` as a template and only re-does the (cheap) SQLite
export + JSON injection.

**Why:** the whole point of `codegraph:view` is "instant, no-ceremony
refresh." A `vite build` adds real seconds; a `sqlite3` export + string
concat is sub-second. The UI code changes rarely; the codebase being
visualized changes constantly (every re-index). Coupling their rebuild
cadence would make the common case (just refresh the data) slow for no
reason.

**If you undo this:** don't. If a future agent is tempted to make
`generate.mjs` "self-healing" by calling `npm run build` automatically
when `src/` is newer than `dist/`, that's reasonable *as an added check*,
but the default path (nothing changed in `src/`) must stay a no-Vite,
sub-second run.

## 2. Vanilla JS → Svelte rewrite (this is the second implementation)

The **first** version of this tool was a single hand-written HTML file with
inline `<script>` (no framework, manual DOM/D3 wiring, manual store-like
globals). It worked, but state management via ad hoc global `let`s got
unwieldy as features (isolate mode, flow view, package focus) accumulated.
It was rewritten into this Svelte project for real reactive state
(`stores.js`) and component boundaries, while deliberately **keeping the
single-file, no-server, `file://`-openable output** — that constraint is
why `vite-plugin-singlefile` is load-bearing here, not incidental. Don't
add a dev server dependency or multi-file dist output; the whole design
point is "one HTML file, no `npm run dev`, opens instantly from disk."

## 3. Bug: changing a filter looked like it did nothing

**What happened:** early on, changing the "hop depth" isolate control (or
any filter) called a full `render()` that rebuilt the force simulation from
scratch with fresh random starting positions. The *data* change was
correct, but the whole graph visibly reshuffled every time, burying the
actual (correct) change in visual noise — so from the user's side it
looked like the control was broken ("clicking hop depth is not showing any
changes").

**Fix, and the rule that came out of it:** state changes that only affect
*styling* (dimming/highlighting a different subset of already-existing
nodes) must restyle the existing DOM in place, never rebuild the
simulation or re-randomize positions. See ARCHITECTURE.md's "Isolate-vs-
rebuild" section — this is the single most important invariant in the
codebase. Every new filter/toggle should be checked against it: does
flipping it rebuild anything that doesn't need rebuilding?

## 4. Bug: a `.hint` overlay silently ate clicks

**What happened:** a bottom-left decorative hint box (`.hint` in
`app.css`) had no `pointer-events: none`, so any graph node that happened
to render underneath it (small bubbles/files near the bottom-left of the
canvas) couldn't be clicked — with **no error**, just a click that did
nothing. Found via automated testing (`elementFromPoint` at the click
coordinate revealed the div), not by visual inspection.

**Rule:** any purely-decorative absolutely-positioned overlay on top of an
interactive canvas needs `pointer-events: none`. If you add a new overlay
(a legend, a badge, a status pill), check this immediately — visual review
alone won't catch it, since the overlay looks fine; only clicking through
it reveals the bug.

## 5. Bug: embedding source code into a `<script>` tag isn't safe by default

**What happened (two separate, compounding bugs when the "code snippet in
side panel" feature was added):**

a. A real source snippet can legitimately contain the literal substring
   `</script` (JSX/HTML strings, test fixtures). Left unescaped, this
   closes the injected `<script>` tag early and corrupts the rest of the
   page. **Fix:** escape `</script` (any case) to `<\/script` before
   injection.

b. Far subtler: `generate.mjs` originally did
   `tpl.replace('</head>', dataScript + '</head>')`. **`String.replace`'s
   string-replacement form treats `$&`, `` $` ``, `$'`, `$1`–`$99`
   specially — even when the search pattern is a plain string, not a
   regex.** With ~22,000 real code snippets embedded, some inevitably
   contained one of these sequences (any file with a regex
   `.replace(/foo/, '$1bar')` call, which is common). The result: chunks of
   the template silently duplicated inside the output, bloating the file
   and (in the worst case) corrupting it. This was invisible in casual
   testing and only surfaced as a multi-hundred-KB size discrepancy,
   tracked down by binary-searching the string for exact byte-for-byte
   duplicate substrings.

**Fix, and the rule:** **never pass a large/arbitrary-content string as the
second argument to `.replace()`.** Use a replacer *function* — it's never
special-cased:
```js
tpl.replace('</head>', () => `${dataScript}</head>`)
```
Any future code that splices untrusted or arbitrary generated content into
a string template must go through a function replacer, full stop.

## 6. Snippets and docstrings: partial coverage is fine, silence is required

**Decision:** `symbol[5]` (snippet) and `symbol[6]` (doc) are both allowed
to be empty strings, and every call site must guard
(`{#if symbol[6]}...{/if}`) rather than assume presence.

**Why:** only ~11% of symbols in this codebase have a docstring, and
snippets can fail to read (renamed/deleted file since the last index). The
alternative — generating descriptions for the rest via an LLM call — was
considered and explicitly deferred (see the option not taken, below): it's
a real feature but a different *kind* of feature (real API cost across
~20k functions, needs a cache keyed on source hash so a re-run doesn't
re-summarize unchanged code). If that's ever built, it should be a
separate, cached, opt-in pass — not folded into `generate.mjs`'s default
fast path.

## 7. Symbol-level graph is a deliberate second dataset, not a reuse of file-level

`fileEdges`/`fileOutAdj` (file-to-file) and `symbolEdges`/`symOutAdj`
(function-to-function) are separate exports and separate adjacency maps,
not one graph rendered at two granularities. The file-level graph
deliberately conflates `imports` and `calls` edges (see DATA_MODEL.md)
because PackageView/FileView are about *dependency structure*; the
symbol-level graph is `calls`-only, symbol-to-symbol, because FlowView is
about *call semantics* ("who calls this function"). Don't try to derive one
from the other at render time — they answer different questions and
deserve different exports.

## 8. Flow view: re-root, never expand depth in place

**What happened:** the "+more" marker on a node whose own callers/callees
extended past the current depth limit originally incremented the *global*
depth control, which re-rendered the **entire existing tree** one level
deeper. For a hub function this compounds: 12 children → each expands to
12 more → the screen becomes an unnavigable wall of nodes. This is
architecturally the same class of bug as #3 (a control silently doing much
more than the user asked for) but at the tree-shape level instead of the
styling level.

**Fix:** clicking *any* node (including a "more →" node) re-roots the
diagram there instead — `flowDrillTo()` always resets depth to `1` and
replaces the tree entirely, so every screen shows at most one small
neighborhood, however many hops deep you've navigated via the trail
breadcrumb. The manual depth control (1/2/3/4/6) still exists for
deliberately widening *the current* view, but it's no longer something a
click silently escalates.

**Rule:** in a drill-down UI, a "show me more from here" affordance should
almost always mean *re-center the view on this node*, not *make the
existing view bigger*. The former stays navigable at any tree size; the
latter doesn't.

## 9. Feature-folder grouping is a repo-specific heuristic, not a generic algorithm

`featureGroup()` in `graph.js` looks for a literal `Features/<name>/` path
segment — this matches *this* repo's documented convention (Screens
compose via `Features/<FeatureName>/`, per the project's CLAUDE.md /
EQC doc), not a generic "detect logical modules" algorithm. It degrades
gracefully (files with no such segment bucket as `"Other"`), so it's safe
to reuse this tool against a different repo, but the flow-diagram grouping
will just be less useful there, not broken. If this ever needs to
generalize, don't try to make the heuristic smarter — add a config/detected
convention layer instead, and keep this one as the default for this repo.

## 10. Package classification is similarly a generic-but-tuned heuristic

`classifyPackage()` in `generate.mjs` recognizes a hardcoded list of
monorepo container directory names. It was tuned against this repo's
specific layout (`backends/`, `frontends/`, `shared/*`, `playwright/`) but
written generically (falls back to top-level dir name, or `"root"`) so it
doesn't hard-fail against an unfamiliar repo shape. Same rule as #9: if a
different repo's package boundaries come out wrong, extend the container
list or add a config option — don't special-case one repo's path structure
inline in ways that break for others.

## 11. Svelte is pinned to 4, not 5

`package.json` pins `svelte@^4.2.19` and
`@sveltejs/vite-plugin-svelte@^3.1.2` deliberately — the `^4` plugin
version is what's compatible with Svelte 4's non-runes component model
(all the `.svelte` files here use `export let`, `$:` reactive statements,
and manual `writable` stores — none of Svelte 5's runes). `npm install`
without the pin resolves `@sveltejs/vite-plugin-svelte@^4`, which requires
Svelte 5 as a peer and fails with an `ERESOLVE` conflict against the
pinned Svelte 4. If this project ever moves to Svelte 5, it's a real
migration (runes, `$state`/`$derived` instead of stores) — not a version
bump.

## Option considered and not taken: LLM-generated symbol descriptions

Raised, discussed, explicitly deferred (see #6). Docstring coverage is only
~11%; generating descriptions for the rest is a real, wanted feature but
requires: (a) a cache keyed on a content hash so re-running `generate.mjs`
doesn't re-summarize unchanged symbols, (b) real API cost/time across tens
of thousands of functions, (c) probably a separate, explicitly-invoked
script rather than folding into the default fast export path. Worth
revisiting, but don't casually bolt an API call into `generate.mjs`'s main
loop — it would break the "instant refresh" property that's the whole
reason `codegraph:view` is pleasant to use (see decision #1).
