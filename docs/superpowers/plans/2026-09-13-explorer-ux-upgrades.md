# Explorer UX Upgrades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the highest- and medium-value UX features observed in the `understand-anything` dashboard (hover tooltips, arbitrary-pair path finder, richer inline source viewing, keyboard-shortcut help, graph export, git-diff impact overlay, and an overview/deep-dive density toggle) into codegraph-viz, adapted to codegraph-viz's fully-static, no-LLM architecture.

**Architecture:** codegraph-viz ships one static `dist/index.html` with all graph data pre-baked into `window.__GRAPH_DATA__` at export time (`bin/codegraph-viz.js` + `lib/graph.mjs`). The Svelte app (`app/src/`) reads that data into Svelte stores (`app/src/lib/stores.js`) and renders views driven by `view` store + pure helpers in `app/src/lib/graph.js`. Every new feature here is either (a) a pure client-side computation over the existing adjacency maps (no new export-time data needed), or (b) a small addition to the export step (`lib/graph.mjs`) for git-diff metadata, still computed once at export time — never at runtime, never via a network/LLM call.

**Tech Stack:** Svelte 4 (no SvelteKit), Vite + vite-plugin-singlefile, D3 (FlowView only), highlight.js core (already a dependency), plain-Node `assert`-based tests (`test/smoke.js` pattern) for pure logic — no test framework for `.svelte` files.

**Spec:** No separate spec doc — derived directly from the user's conversation request ("implement the high and medium value features [found by comparing against understand-anything], remember we are full static unlike understand-anything which use LLM"). The full requirement set is captured in Global Constraints below and in each task's rationale.

## Global Constraints

- **No runtime LLM/network calls, ever.** Every feature must work purely from `window.__GRAPH_DATA__` (already exported) or from a one-time addition to the export step (`lib/graph.mjs` / `bin/codegraph-viz.js`), which itself must only shell out to `git` (no network, no AI).
- **Zero new npm dependencies.** The app is bundled as a single HTML file via `vite-plugin-singlefile`; every feature must be built from Svelte + D3 + highlight.js + DOMPurify + marked (already present).
- **Theming:** reuse existing CSS custom properties only — `--surface`, `--surface-2`, `--border`, `--text`, `--muted`, `--accent`, `--accent-soft`, `--calls`. UI font: `var(--vscode-font-family, 'Manrope', sans-serif)`. Code font: `var(--vscode-editor-font-family, 'JetBrains Mono', monospace)`.
- **Keyboard shortcuts:** must go through the existing `isTypingTarget()` guard in `app/src/App.svelte` (don't fire while a search/text input is focused) and must not collide with existing bindings: `Escape`, `/`, `f`, `a`, `b`.
- **Testing:** `.svelte` components have no existing test harness — verify those tasks by running `cd app && npx vite build` (must succeed with no new warnings) plus a manual dev-server check (`cd app && npx vite`) described in the task. Pure-logic additions to `app/src/lib/graph.js` and `lib/graph.mjs` DO get plain-Node `assert` tests, following `test/smoke.js`'s existing style (fake data in, assert shape out) — add them to a new `test/graph-client-smoke.js` and wire it into the root `package.json` `test` script.
- **No new files under `app/src/lib` may introduce Svelte stores that aren't cleaned up** — every `writable` added must have a clear "who resets this" story (mirror the pattern already used by `selectedSymbol`/`selectedFile` being cleared in `actions.js`).

---

## File Structure

New files:
- `app/src/lib/Modal.svelte` — generic centered-overlay modal shell (backdrop, Escape-to-close, focus trap not required since Escape/`✕`/backdrop-click all close it). Reused by Tasks 3, 4, 5.
- `app/src/lib/NodeTooltip.svelte` — floating tooltip rendered from a single shared store; positioned at the last mousemove coords.
- `app/src/lib/PathFinderModal.svelte` — "find path between any two symbols" modal.
- `app/src/lib/KeyboardShortcutsHelp.svelte` — `?`-triggered shortcut reference modal.
- `app/src/lib/SourceModal.svelte` — expanded, syntax-highlighted, copyable source view for a symbol's snippet.
- `app/src/lib/export.js` — `svgToSvgString(svgEl)` / `svgToPngDataUrl(svgEl)` pure DOM helpers, no deps.
- `app/src/lib/ExportMenu.svelte` — small dropdown button ("Export ▾" → PNG / SVG) for FlowView.
- `app/src/lib/DiffToggle.svelte` — header toggle turning the git-diff overlay on/off, with changed/affected counts.
- `test/graph-client-smoke.js` — plain-Node assertions for the new pure functions in `app/src/lib/graph.js`.

Modified files:
- `app/src/lib/graph.js` — add `shortestPath()`, `blastRadius()`.
- `app/src/lib/stores.js` — add `tooltipState`, `pathFinderOpen`, `shortcutsHelpOpen`, `sourceModalSymId`, `detailMode`, `diffOverlayOn` writables.
- `app/src/App.svelte` — wire new keyboard shortcuts (`p`, `?`, `e`, `d`) and mount the new modal components.
- `app/src/lib/Header.svelte` — add buttons that open PathFinderModal / KeyboardShortcutsHelp, and mount `DiffToggle`.
- `app/src/lib/FlowView.svelte` — wire node hover → `tooltipState`, mount `ExportMenu`, apply diff-overlay node coloring.
- `app/src/lib/DetailPanel.svelte` — syntax-highlight the snippet, add "expand" button opening `SourceModal`, add Overview/Deep-dive conditional rendering driven by `detailMode`.
- `app/src/lib/Sidebar.svelte` — add the Overview/Deep-dive toggle control.
- `lib/graph.mjs` — `extractGraph()` gains an optional `gitDiffRef` argument; when set, adds `changedFileIdxs: number[]` to the returned data via `git diff --name-only`.
- `bin/codegraph-viz.js` — add a `--diff <ref>` CLI flag, passed through to `extractGraph`.
- `test/smoke.js` — add assertions for the new `changedFileIdxs` behavior.
- `package.json` (root) — `test` script runs both smoke files.

---

### Task 1: `shortestPath` + `blastRadius` pure graph helpers

**Files:**
- Modify: `app/src/lib/graph.js:668` (right after `transitiveReach`, before the `findEntryPathsToSymbol` comment block)
- Create: `test/graph-client-smoke.js`
- Modify: `package.json:8` (root) — `"test": "node test/smoke.js"` → `"test": "node test/smoke.js && node test/graph-client-smoke.js"`

**Interfaces:**
- Produces: `shortestPath(fromId, toId, symOutAdj, symInAdj)` → `number[] | null`. Treats the call graph as undirected (merges `symOutAdj`/`symInAdj` neighbors) since the user picking two arbitrary symbols cares about *any* connecting chain, not just one call direction. Returns the ordered list of symIds from `fromId` to `toId` inclusive, or `null` if disconnected. Returns `[fromId]` when `fromId === toId`.
- Produces: `blastRadius(changedSymIds, symInAdj)` → `Set<number>`. BFS over `symInAdj` (transitive callers) starting from every id in `changedSymIds`; the returned set always includes every id in `changedSymIds` itself. Used later by Task 8's diff overlay.
- Consumes (existing): the `Map<number, [number, number][]>` shape already produced by `buildAdjacency()` in `graph.js:72`.

- [ ] **Step 1: Write the test file exercising both functions against a small fixed graph**

```js
// test/graph-client-smoke.js
// Smoke test for the pure client-side graph helpers in app/src/lib/graph.js
// — plain Node, no Svelte/Vite involved, mirrors test/smoke.js's style.
import assert from 'node:assert/strict';
import { buildAdjacency, shortestPath, blastRadius } from '../app/src/lib/graph.js';

// Graph: 0 -> 1 -> 2 -> 3, and 4 -> 1 (a second caller of 1), 5 is isolated.
const edges = [
  [0, 1, 1], [1, 2, 1], [2, 3, 1], [4, 1, 1],
];
const { out, inn } = buildAdjacency(edges);

// shortestPath: forward chain
assert.deepEqual(shortestPath(0, 3, out, inn), [0, 1, 2, 3]);
// shortestPath: undirected — from a callee back to an unrelated caller of a shared node
assert.deepEqual(shortestPath(3, 4, out, inn), [3, 2, 1, 4]);
// shortestPath: same node
assert.deepEqual(shortestPath(2, 2, out, inn), [2]);
// shortestPath: disconnected
assert.equal(shortestPath(5, 0, out, inn), null);

// blastRadius: from node 3, transitive callers are 2, 1, 0, 4 — plus 3 itself
const radius = blastRadius([3], inn);
assert.deepEqual([...radius].sort((a, b) => a - b), [0, 1, 2, 3, 4]);
// blastRadius: multiple seeds union correctly and don't double-walk
const radius2 = blastRadius([3, 5], inn);
assert.deepEqual([...radius2].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);

console.log('graph-client-smoke: OK');
```

- [ ] **Step 2: Run it to verify it fails (functions don't exist yet)**

Run: `node test/graph-client-smoke.js`
Expected: `SyntaxError` or `TypeError: shortestPath is not a function` (import fails because `graph.js` doesn't export it yet).

- [ ] **Step 3: Implement `shortestPath` and `blastRadius` in `app/src/lib/graph.js`**

Insert directly after the `transitiveReach` function (after its closing `}` at line 674, before the `findEntryPathsToSymbol` doc comment):

```js
// BFS shortest path between two arbitrary symbols, walking the call graph as
// UNDIRECTED (both symOutAdj and symInAdj neighbors) — a user picking two
// symbols in the Path Finder modal wants "how does A relate to B at all",
// not "does A call B" specifically. Returns the ordered symId chain
// (inclusive of both ends), or null if no path exists within the graph.
export function shortestPath(fromId, toId, symOutAdj, symInAdj) {
  if (fromId === toId) return [fromId];
  const prev = new Map([[fromId, null]]);
  const queue = [fromId];
  let qi = 0;
  while (qi < queue.length) {
    const id = queue[qi++];
    const neighbors = [
      ...(symOutAdj.get(id) || []).map(([n]) => n),
      ...(symInAdj.get(id) || []).map(([n]) => n),
    ];
    for (const next of neighbors) {
      if (prev.has(next)) continue;
      prev.set(next, id);
      if (next === toId) {
        const path = [toId];
        let cur = toId;
        while (prev.get(cur) !== null) {
          cur = prev.get(cur);
          path.push(cur);
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

// Every symbol that transitively depends on (transitively calls into) any of
// `changedSymIds` — walks symInAdj (callers) outward from each seed. Used by
// the diff/blast-radius overlay: "if these symbols changed, what else could
// break". Always includes the seeds themselves so the overlay can render
// "changed" vs "affected" as two subsets of the same set.
export function blastRadius(changedSymIds, symInAdj) {
  const visited = new Set(changedSymIds);
  const stack = [...changedSymIds];
  while (stack.length) {
    const id = stack.pop();
    for (const [caller] of (symInAdj.get(id) || [])) {
      if (!visited.has(caller)) {
        visited.add(caller);
        stack.push(caller);
      }
    }
  }
  return visited;
}
```

- [ ] **Step 4: Run the test again to verify it passes**

Run: `node test/graph-client-smoke.js`
Expected: prints `graph-client-smoke: OK`, exit code 0.

- [ ] **Step 5: Wire the new test into the root `test` script and run the full suite**

Edit `package.json` (root):

```diff
-    "test": "node test/smoke.js"
+    "test": "node test/smoke.js && node test/graph-client-smoke.js"
```

Run: `npm test`
Expected: both smoke tests print OK, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/graph.js test/graph-client-smoke.js package.json
git commit -m "feat: add shortestPath and blastRadius graph helpers"
```

---

### Task 2: Rich hover tooltip on FlowView nodes

**Files:**
- Create: `app/src/lib/NodeTooltip.svelte`
- Modify: `app/src/lib/stores.js` (add `tooltipState`)
- Modify: `app/src/lib/FlowView.svelte` (wire mouseenter/mousemove/mouseleave on the D3 node groups; mount `<NodeTooltip />`)
- Modify: `app/src/App.svelte` (mount `<NodeTooltip />` once, globally, so it survives view switches without duplicate instances)

**Interfaces:**
- Consumes: `transitiveReach` (`graph.js:668`, already used elsewhere), `symInAdj`/`symOutAdj` (`stores.js`), `complexity()` (`graph.js:331`).
- Produces: `tooltipState` writable in `stores.js`: `{ x: number, y: number, symId: number } | null`. Any view can set it on hover; `NodeTooltip.svelte` is the single consumer.

- [ ] **Step 1: Add the `tooltipState` store**

In `app/src/lib/stores.js`, after the `selectedFile`/`selectedSymbol`/`searchQuery` block (around line 107):

```js
// ---------- hover tooltip ----------
// { x, y, symId } in viewport coordinates, or null when nothing is hovered.
// A single shared store so only one NodeTooltip instance needs to exist
// (mounted once in App.svelte) no matter which view is showing nodes.
export const tooltipState = writable(null);
```

- [ ] **Step 2: Build `NodeTooltip.svelte`**

```svelte
<script>
  import { DATA, tooltipState, symInAdj, symOutAdj } from './stores.js';
  import { complexity, displayName } from './graph.js';

  $: t = $tooltipState;
  $: sym = t ? DATA.symbols[t.symId] : null;
  $: callerCount = t ? (symInAdj.get(t.symId) || []).length : 0;
  $: calleeCount = t ? (symOutAdj.get(t.symId) || []).length : 0;
  $: symComplexity = sym ? complexity(sym[5]) : 0;
  $: firstDocLine = sym && sym[6] ? sym[6].split('\n')[0] : '';
</script>

{#if t && sym}
  <div class="node-tooltip" style="left:{t.x + 14}px; top:{t.y + 14}px;">
    <div class="row1">
      <span class="kind">{sym[1]}</span>
      <span class="name mono">{sym[0]}</span>
    </div>
    <div class="row2">
      <span title="Heuristic cyclomatic complexity">cx {symComplexity}</span>
      <span title="Direct callers">↓ {callerCount} in</span>
      <span title="Direct callees">↑ {calleeCount} out</span>
    </div>
    {#if firstDocLine}<div class="doc">{firstDocLine}</div>{/if}
    <div class="file mono">{displayName(DATA.files[sym[4]][0])}</div>
  </div>
{/if}

<style>
  .node-tooltip {
    position: fixed;
    z-index: 200;
    pointer-events: none;
    max-width: 280px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 10px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    font-family: var(--vscode-font-family, 'Manrope', sans-serif);
    font-size: 11px;
    color: var(--text);
  }
  .row1 {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin-bottom: 4px;
  }
  .kind {
    color: var(--muted);
    text-transform: uppercase;
    font-size: 9.5px;
    letter-spacing: 0.04em;
  }
  .name { font-weight: 700; }
  .row2 {
    display: flex;
    gap: 10px;
    color: var(--muted);
    font-size: 10.5px;
    margin-bottom: 4px;
  }
  .doc {
    color: var(--text);
    margin-bottom: 4px;
    line-height: 1.3;
  }
  .file {
    color: var(--muted);
    font-size: 10px;
  }
</style>
```

- [ ] **Step 3: Mount it once in `App.svelte`**

In `app/src/App.svelte`, add the import near the other view imports and mount it inside `<div class="body-row">` so it overlays everything:

```diff
   import DetailPanel from './lib/DetailPanel.svelte';
+  import NodeTooltip from './lib/NodeTooltip.svelte';
```

```diff
   </main>
   <DetailPanel />
+  <NodeTooltip />
 </div>
```

- [ ] **Step 4: Wire hover events onto FlowView's D3 node groups**

In `app/src/lib/FlowView.svelte`, import the store and update `drawTree`'s node selection (the `const node = ...` block around line 96):

```diff
-  import { DATA, symOutAdj, symInAdj, flowRoot, flowDirection, flowDepth, flowFeatureFilter, packageFilter, flowTrail } from './stores.js';
+  import { DATA, symOutAdj, symInAdj, flowRoot, flowDirection, flowDepth, flowFeatureFilter, packageFilter, flowTrail, tooltipState } from './stores.js';
```

```diff
     const node = g.append('g').selectAll('g').data(hierarchy.descendants()).join('g')
       .attr('transform', d => `translate(${sx(d.y) - NODE_W / 2},${d.x - NODE_H / 2})`)
-      .style('cursor', d => d.data.cyclic ? 'default' : 'pointer');
+      .style('cursor', d => d.data.cyclic ? 'default' : 'pointer')
+      .on('mouseenter', (event, d) => {
+        tooltipState.set({ x: event.clientX, y: event.clientY, symId: d.data.symId });
+      })
+      .on('mousemove', (event, d) => {
+        tooltipState.update(cur => cur ? { ...cur, x: event.clientX, y: event.clientY } : cur);
+      })
+      .on('mouseleave', () => tooltipState.set(null));
```

Note: `d.data.symId` must exist on the tree node data. Check `buildFlowTree` in `graph.js:104` — confirm the field name it uses for the symbol id on each tree node (it may be `id` rather than `symId`); use whatever that function actually names it so the tooltip resolves the right symbol. Read `graph.js:104-146` before writing this step's real diff.

- [ ] **Step 5: Verify manually**

Run: `cd app && npx vite`
Open the dev server, navigate into a Flow view (`f` on a selected symbol, or via Header), hover a node. Expect: tooltip appears near the cursor with kind/name/complexity/in-out counts/doc/file, follows the mouse, disappears on mouseleave.

- [ ] **Step 6: Build to confirm no errors**

Run: `cd app && npx vite build`
Expected: succeeds, no new warnings besides the pre-existing `Sidebar.svelte` unused-selector one.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/NodeTooltip.svelte app/src/lib/stores.js app/src/lib/FlowView.svelte app/src/App.svelte
git commit -m "feat: add hover tooltip to flow view nodes"
```

---

### Task 3: Generic `Modal.svelte` shell + Path Finder modal

**Files:**
- Create: `app/src/lib/Modal.svelte`
- Create: `app/src/lib/PathFinderModal.svelte`
- Modify: `app/src/lib/stores.js` (add `pathFinderOpen`)
- Modify: `app/src/lib/Header.svelte` (add a "Find path" button)
- Modify: `app/src/App.svelte` (mount `<PathFinderModal />`, add `p` shortcut)

**Interfaces:**
- Consumes: `shortestPath()` from Task 1, `jumpToSymbol()` (`actions.js:54`), `pkgColor`/`displayName` (`graph.js`).
- Produces: `pathFinderOpen` writable boolean in `stores.js`. `Modal.svelte` takes an `open` prop (boolean) and an `on:close` event — reused verbatim by Tasks 4 and 5.

- [ ] **Step 1: Build the generic `Modal.svelte`**

```svelte
<script>
  import { createEventDispatcher } from 'svelte';
  export let open = false;
  export let title = '';
  const dispatch = createEventDispatcher();
  function close() { dispatch('close'); }
  function onKeydown(e) { if (e.key === 'Escape') close(); }
</script>

<svelte:window on:keydown={open ? onKeydown : null} />

{#if open}
  <div class="modal-backdrop" on:click={close}>
    <div class="modal-box" on:click|stopPropagation>
      <div class="modal-head">
        <h3>{title}</h3>
        <button class="modal-close" on:click={close}>✕</button>
      </div>
      <div class="modal-body">
        <slot />
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 300;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 10vh;
  }
  .modal-box {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    width: min(560px, 92vw);
    max-height: 76vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
    font-family: var(--vscode-font-family, 'Manrope', sans-serif);
  }
  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }
  .modal-head h3 { margin: 0; font-size: 14px; color: var(--text); }
  .modal-close {
    background: none;
    border: none;
    color: var(--muted);
    font-size: 14px;
    cursor: pointer;
  }
  .modal-close:hover { color: var(--accent); }
  .modal-body {
    padding: 14px 16px;
    overflow-y: auto;
  }
</style>
```

- [ ] **Step 2: Add the `pathFinderOpen` store**

In `app/src/lib/stores.js`, next to `tooltipState`:

```js
export const pathFinderOpen = writable(false);
```

- [ ] **Step 3: Build `PathFinderModal.svelte`**

```svelte
<script>
  import { DATA, pathFinderOpen, symOutAdj, symInAdj } from './stores.js';
  import { shortestPath, pkgColor, displayName } from './graph.js';
  import { jumpToSymbol } from './actions.js';

  let fromQuery = '';
  let toQuery = '';
  let fromId = null;
  let toId = null;
  let path = undefined; // undefined = not computed yet, null = no path found

  $: fromMatches = fromQuery.trim().length > 1
    ? DATA.symbols
        .map((s, i) => ({ i, s }))
        .filter(({ s }) => s[0].toLowerCase().includes(fromQuery.trim().toLowerCase()))
        .slice(0, 8)
    : [];
  $: toMatches = toQuery.trim().length > 1
    ? DATA.symbols
        .map((s, i) => ({ i, s }))
        .filter(({ s }) => s[0].toLowerCase().includes(toQuery.trim().toLowerCase()))
        .slice(0, 8)
    : [];

  function pickFrom(i) { fromId = i; fromQuery = DATA.symbols[i][0]; path = undefined; }
  function pickTo(i) { toId = i; toQuery = DATA.symbols[i][0]; path = undefined; }

  function findPath() {
    if (fromId === null || toId === null) return;
    path = shortestPath(fromId, toId, symOutAdj, symInAdj);
  }

  function close() { pathFinderOpen.set(false); }

  function jump(symId) {
    close();
    jumpToSymbol(symId);
  }
</script>

<Modal open={$pathFinderOpen} title="Find path between symbols" on:close={close}>
  <div class="pf-row">
    <input placeholder="From symbol…" bind:value={fromQuery} on:input={() => (fromId = null)} />
    {#if fromMatches.length > 0 && fromId === null}
      <div class="pf-suggest">
        {#each fromMatches as m (m.i)}
          <button on:click={() => pickFrom(m.i)}>{m.s[0]} <span class="muted">· {m.s[1]}</span></button>
        {/each}
      </div>
    {/if}
  </div>
  <div class="pf-row">
    <input placeholder="To symbol…" bind:value={toQuery} on:input={() => (toId = null)} />
    {#if toMatches.length > 0 && toId === null}
      <div class="pf-suggest">
        {#each toMatches as m (m.i)}
          <button on:click={() => pickTo(m.i)}>{m.s[0]} <span class="muted">· {m.s[1]}</span></button>
        {/each}
      </div>
    {/if}
  </div>
  <button class="pf-find" disabled={fromId === null || toId === null} on:click={findPath}>Find path</button>

  {#if path === null}
    <div class="pf-empty">No path found between these two symbols.</div>
  {:else if path}
    <div class="pf-chain">
      {#each path as symId, i (symId)}
        {#if i > 0}<span class="pf-arrow">→</span>{/if}
        <button class="pf-chip" style="border-color:{pkgColor(DATA.files[DATA.symbols[symId][4]][1])}" on:click={() => jump(symId)}>
          {DATA.symbols[symId][0]}
          <span class="muted">· {displayName(DATA.files[DATA.symbols[symId][4]][0])}</span>
        </button>
      {/each}
    </div>
  {/if}
</Modal>

<style>
  .pf-row { position: relative; margin-bottom: 10px; }
  .pf-row input {
    width: 100%;
    box-sizing: border-box;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 7px 10px;
    font-family: inherit;
    font-size: 12.5px;
    outline: none;
  }
  .pf-suggest {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 10;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    margin-top: 2px;
    max-height: 160px;
    overflow-y: auto;
  }
  .pf-suggest button {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    color: var(--text);
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  .pf-suggest button:hover { background: var(--surface-2); }
  .pf-find {
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 7px 14px;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    margin-bottom: 10px;
  }
  .pf-find:disabled { opacity: 0.4; cursor: default; }
  .pf-empty { color: var(--muted); font-size: 12.5px; }
  .pf-chain { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .pf-chip {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 5px 9px;
    font-size: 11.5px;
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    color: var(--text);
    cursor: pointer;
  }
  .pf-arrow { color: var(--muted); }
  .muted { color: var(--muted); }
</style>
```

Add the `Modal` import at the top of the script block:

```diff
   import { DATA, pathFinderOpen, symOutAdj, symInAdj } from './stores.js';
   import { shortestPath, pkgColor, displayName } from './graph.js';
   import { jumpToSymbol } from './actions.js';
+  import Modal from './Modal.svelte';
```

- [ ] **Step 4: Mount it and add the `p` shortcut in `App.svelte`**

```diff
   import NodeTooltip from './lib/NodeTooltip.svelte';
+  import PathFinderModal from './lib/PathFinderModal.svelte';
```

```diff
   <DetailPanel />
   <NodeTooltip />
+  <PathFinderModal />
 </div>
```

In the keydown `handler` function (after the `if (key === '/')` block, before the `if (symId === null) return;` line — this shortcut should work with or without a symbol selected):

```diff
       if (key === '/') {
         ev.preventDefault();
         const searchInput = document.querySelector('input[placeholder*="AddEditOutcomeModal"], input[placeholder*="Filter"]');
         if (searchInput) { searchInput.focus(); searchInput.select(); }
         return;
       }
+      if (key === 'p') {
+        ev.preventDefault();
+        pathFinderOpen.set(true);
+        return;
+      }
       if (symId === null) return;
```

Add `pathFinderOpen` to the store import at the top of `App.svelte`:

```diff
   import {
     view, currentPkg, flowRoot, allFlowsRoot, selectedSymbol, searchQuery,
-    packageFilter, symbolKindFilter,
+    packageFilter, symbolKindFilter, pathFinderOpen,
   } from './lib/stores.js';
```

- [ ] **Step 5: Add a header button as a discoverable, non-keyboard entry point**

In `app/src/lib/Header.svelte`, import the store and add a button next to `.spacer`:

```diff
-  import { DATA, view, currentPkg, flowRoot, flowDirection, flowTrail, allFlowsRoot } from './stores.js';
+  import { DATA, view, currentPkg, flowRoot, flowDirection, flowTrail, allFlowsRoot, pathFinderOpen } from './stores.js';
```

```diff
   <div class="spacer"></div>
+  <button class="find-path-btn" title="Find path between two symbols (p)" on:click={() => pathFinderOpen.set(true)}>⇄ Find path</button>
   <div class="stats">
```

Add matching CSS in the `<style>` block, mirroring `.back-btn`:

```css
  .find-path-btn {
    background: var(--surface-2);
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 10px;
    font-family: var(--vscode-font-family, 'Manrope', sans-serif);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    margin-right: 12px;
  }
  .find-path-btn:hover { color: var(--accent); border-color: var(--accent); }
```

- [ ] **Step 6: Verify manually**

Run: `cd app && npx vite`. Press `p` (with focus outside any input) — modal opens. Type into "From"/"To", pick suggestions, click "Find path" — chain renders with clickable chips; clicking a chip closes the modal and jumps to that symbol in the file view. Press `Escape` or click backdrop — modal closes. Click the header "⇄ Find path" button — same modal opens.

- [ ] **Step 7: Build to confirm no errors**

Run: `cd app && npx vite build`

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/Modal.svelte app/src/lib/PathFinderModal.svelte app/src/lib/stores.js app/src/lib/Header.svelte app/src/App.svelte
git commit -m "feat: add path finder modal for arbitrary symbol pairs"
```

---

### Task 4: Keyboard shortcuts help modal (`?`)

**Files:**
- Create: `app/src/lib/KeyboardShortcutsHelp.svelte`
- Modify: `app/src/lib/stores.js` (add `shortcutsHelpOpen`)
- Modify: `app/src/App.svelte` (mount it, add `?` shortcut, list every existing + new binding)

**Interfaces:**
- Consumes: `Modal.svelte` from Task 3.
- Produces: `shortcutsHelpOpen` writable boolean.

- [ ] **Step 1: Add the store**

```js
export const shortcutsHelpOpen = writable(false);
```

- [ ] **Step 2: Build `KeyboardShortcutsHelp.svelte`**

```svelte
<script>
  import { shortcutsHelpOpen } from './stores.js';
  import Modal from './Modal.svelte';

  const SHORTCUTS = [
    { key: '/', desc: 'Focus the current search / filter box' },
    { key: 'f', desc: 'Open flow view (calls) for the selected symbol' },
    { key: 'a', desc: 'Open all-paths view for the selected symbol' },
    { key: 'b', desc: 'Back to the previous view' },
    { key: 'p', desc: 'Open the path finder (find a path between any two symbols)' },
    { key: 'e', desc: 'Export the current flow diagram (PNG/SVG)' },
    { key: 'd', desc: 'Toggle the git-diff impact overlay' },
    { key: 'Escape', desc: 'Close the current modal / clear search / deselect / go to Packages' },
    { key: '?', desc: 'Show this help' },
  ];

  function close() { shortcutsHelpOpen.set(false); }
</script>

<Modal open={$shortcutsHelpOpen} title="Keyboard shortcuts" on:close={close}>
  <table class="shortcuts-table">
    <tbody>
      {#each SHORTCUTS as s (s.key)}
        <tr>
          <td><kbd>{s.key}</kbd></td>
          <td>{s.desc}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</Modal>

<style>
  .shortcuts-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .shortcuts-table td { padding: 6px 8px; border-bottom: 1px solid var(--border); color: var(--text); }
  .shortcuts-table td:first-child { width: 70px; }
  kbd {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 2px 6px;
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    font-size: 11.5px;
  }
</style>
```

- [ ] **Step 3: Mount it and add the `?` shortcut in `App.svelte`**

```diff
   import PathFinderModal from './lib/PathFinderModal.svelte';
+  import KeyboardShortcutsHelp from './lib/KeyboardShortcutsHelp.svelte';
```

```diff
   <PathFinderModal />
+  <KeyboardShortcutsHelp />
 </div>
```

```diff
-    packageFilter, symbolKindFilter, pathFinderOpen,
+    packageFilter, symbolKindFilter, pathFinderOpen, shortcutsHelpOpen,
```

```diff
       if (key === 'p') {
         ev.preventDefault();
         pathFinderOpen.set(true);
         return;
       }
+      if (key === '?') {
+        ev.preventDefault();
+        shortcutsHelpOpen.set(true);
+        return;
+      }
       if (symId === null) return;
```

Also extend the existing `Escape` branch so it closes these modals first (highest priority — a modal open should eat Escape before search/selection/view get touched). Find the `if (key === 'Escape') { ... }` block and add at its top, right after the typing-target blur check:

```diff
       if (key === 'Escape') {
         const active = document.activeElement;
         if (active && isTypingTarget(active)) { active.blur(); return; }
+        if (get(shortcutsHelpOpen)) { shortcutsHelpOpen.set(false); return; }
+        if (get(pathFinderOpen)) { pathFinderOpen.set(false); return; }
         if (get(searchQuery)) { searchQuery.set(''); return; }
```

(`Modal.svelte` also listens for Escape itself via `<svelte:window>`, but the global handler runs too — closing the store directly here keeps behavior identical whether or not the modal component happens to be mounted, and avoids relying on event-listener ordering between two separate `keydown` listeners.)

- [ ] **Step 4: Verify manually**

Run: `cd app && npx vite`. Press `?` — help modal opens listing all shortcuts. Press `Escape` — closes. Open Path Finder (`p`), then press `Escape` — closes Path Finder, not the whole app view.

- [ ] **Step 5: Build to confirm no errors**

Run: `cd app && npx vite build`

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/KeyboardShortcutsHelp.svelte app/src/lib/stores.js app/src/App.svelte
git commit -m "feat: add keyboard shortcuts help modal"
```

---

### Task 5: Syntax-highlighted source in DetailPanel + expand-to-modal source viewer

**Files:**
- Create: `app/src/lib/SourceModal.svelte`
- Modify: `app/src/lib/DetailPanel.svelte:211-225` (the existing `Source` block)
- Modify: `app/src/lib/stores.js` (none needed — `SourceModal` takes the symbol id as a local prop toggled by a local boolean in `DetailPanel`, no global store required since only one symbol's source can be open at a time and it's always the currently-selected symbol)

**Interfaces:**
- Consumes: `highlightBlock(text, language)` from `app/src/lib/highlight.js:72` (already exists, currently unused by `DetailPanel`), `Modal.svelte` from Task 3.

- [ ] **Step 1: Confirm `highlightBlock`'s signature**

Read `app/src/lib/highlight.js:72-90` before writing the diff below — confirm it returns an HTML string (safe to use with `{@html}` since it's highlight.js's own escaped output, same trust level as the existing `PathSnippetCard.svelte` usage) and what parameter order it expects.

- [ ] **Step 2: Replace the plain-text snippet loop in `DetailPanel.svelte` with a highlighted block + expand button**

Current code (`DetailPanel.svelte:211-225`):

```svelte
    {#if symbol[5]}
      <div class="panel-title">Source</div>
      <div class="snippet mono">
        {#each snippetLines as line, i}
          {#if i === snippetLines.length - 1 && snippetTruncated}
            <div class="snippet-line truncated"><span class="trunc">{line}</span></div>
          {:else}
            <div class="snippet-line">
              <a class="ln" href={vscodeUri(symbolFile[0], snippetStart + i)} title={projectRoot ? `Open line ${snippetStart + i} in VS Code` : 'No project root'}>{snippetStart + i}</a>
              <span class="code">{line || ' '}</span>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
```

Replace with:

```svelte
    {#if symbol[5]}
      <div class="panel-title-row">
        <div class="panel-title" style="margin:0;">Source</div>
        <button class="flow-link" on:click={() => (sourceModalOpen = true)}>expand →</button>
      </div>
      <div class="snippet mono">
        {#each snippetLines as line, i}
          {#if i === snippetLines.length - 1 && snippetTruncated}
            <div class="snippet-line truncated"><span class="trunc">{line}</span></div>
          {:else}
            <div class="snippet-line">
              <a class="ln" href={vscodeUri(symbolFile[0], snippetStart + i)} title={projectRoot ? `Open line ${snippetStart + i} in VS Code` : 'No project root'}>{snippetStart + i}</a>
              <span class="code">{@html highlightLine(line || ' ', symbolFile[2])}</span>
            </div>
          {/if}
        {/each}
      </div>
      <SourceModal
        open={sourceModalOpen}
        name={symbol[0]}
        snippet={symbol[5]}
        language={symbolFile[2]}
        filePath={symbolFile[0]}
        startLine={snippetStart}
        on:close={() => (sourceModalOpen = false)}
      />
    {/if}
```

Add to the `<script>` block (near the other symbol-derived reactive declarations, after `snippetTruncated` around line 96):

```diff
   $: snippetTruncated = lastSnippetLine.startsWith('…');
+  let sourceModalOpen = false;
```

Add the two new imports at the top:

```diff
-  import { pkgColor, shortPkg, displayName, complexity, findRelatedTests, transitiveReach, parseSignature, parseTypeBody } from './graph.js';
+  import { pkgColor, shortPkg, displayName, complexity, findRelatedTests, transitiveReach, parseSignature, parseTypeBody } from './graph.js';
+  import { highlightLine } from './highlight.js';
+  import SourceModal from './SourceModal.svelte';
```

`sourceModalOpen` is reset to `false` implicitly whenever `symbol` changes because Svelte re-mounts this whole `{#if symbol}` block's local state is NOT preserved across `$selectedSymbol` changes only if the block key changes — since there's no `{#key}` wrapper here, explicitly reset it: add a reactive statement right under the `let sourceModalOpen = false;` line:

```js
  $: if (symbol) sourceModalOpen = false;
```

(Runs whenever `symbol` reference changes — including when Svelte's reactivity re-fires because `$selectedSymbol` changed — closing any lingering modal from the previously-viewed symbol.)

- [ ] **Step 3: Build `SourceModal.svelte`**

```svelte
<script>
  import { createEventDispatcher } from 'svelte';
  import { highlightBlock } from './highlight.js';
  import Modal from './Modal.svelte';

  export let open = false;
  export let name = '';
  export let snippet = '';
  export let language = '';
  export let filePath = '';
  export let startLine = 1;

  const dispatch = createEventDispatcher();
  function close() { dispatch('close'); }

  $: html = snippet ? highlightBlock(snippet, language) : '';
  $: lineCount = snippet ? snippet.split('\n').length : 0;

  let copied = false;
  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch { /* clipboard unavailable */ }
  }
</script>

<Modal open={open} title={`${name} · ${filePath}:${startLine}`} on:close={close}>
  <div class="src-toolbar">
    <span class="muted">{lineCount} lines</span>
    <button class="copy-btn" on:click={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
  </div>
  <pre class="src-block"><code>{@html html}</code></pre>
</Modal>

<style>
  .src-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    font-size: 11.5px;
  }
  .muted { color: var(--muted); }
  .copy-btn {
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 3px 9px;
    font-size: 11px;
    cursor: pointer;
  }
  .copy-btn:hover { color: var(--accent); border-color: var(--accent); }
  .src-block {
    margin: 0;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    overflow-x: auto;
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    font-size: 12px;
    line-height: 1.5;
  }
</style>
```

Widen `Modal.svelte`'s `.modal-box` for this use case by passing a size, OR simplify: since `Modal.svelte`'s width is a fixed `min(560px, 92vw)`, source code needs more room. Add an optional `wide` prop to `Modal.svelte` instead of hardcoding — revisit Task 3's `Modal.svelte`:

```diff
   export let open = false;
   export let title = '';
+  export let wide = false;
```

```diff
-    <div class="modal-box" on:click|stopPropagation>
+    <div class="modal-box" class:wide on:click|stopPropagation>
```

```diff
   .modal-box {
     background: var(--surface);
     border: 1px solid var(--border);
     border-radius: 10px;
     width: min(560px, 92vw);
     max-height: 76vh;
```
```diff
   .modal-close:hover { color: var(--accent); }
+  .modal-box.wide { width: min(880px, 94vw); }
```

And pass it from `SourceModal.svelte`:

```diff
-<Modal open={open} title={`${name} · ${filePath}:${startLine}`} on:close={close}>
+<Modal open={open} wide title={`${name} · ${filePath}:${startLine}`} on:close={close}>
```

- [ ] **Step 4: Verify manually**

Run: `cd app && npx vite`. Select a symbol with a snippet. Confirm the inline "Source" block now shows syntax-colored code (not plain white-on-dark). Click "expand →" — modal opens with the same snippet, larger, with a working "Copy" button (paste it somewhere to confirm). Close via `✕`, backdrop click, and `Escape`.

- [ ] **Step 5: Build to confirm no errors**

Run: `cd app && npx vite build`

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/SourceModal.svelte app/src/lib/DetailPanel.svelte app/src/lib/Modal.svelte
git commit -m "feat: syntax-highlight symbol source and add expand-to-modal viewer"
```

---

### Task 6: Export flow diagram as PNG/SVG

**Files:**
- Create: `app/src/lib/export.js`
- Create: `app/src/lib/ExportMenu.svelte`
- Modify: `app/src/lib/FlowView.svelte` (mount `<ExportMenu svgEl={svgEl} />`)
- Modify: `app/src/App.svelte` (add `e` shortcut — dispatches a custom event FlowView listens for, since the SVG element only exists inside FlowView)

**Interfaces:**
- Produces: `svgToSvgString(svgEl)` → `string` (serialized, self-contained SVG with inline styles resolved... see Step 1 note on `var(--...)` colors). `svgToPngDataUrl(svgEl, scale = 2)` → `Promise<string>` (data URL).
- Consumes: `svgEl` binding already present in `FlowView.svelte:8`.

- [ ] **Step 1: Build `export.js`**

D3's rendering uses CSS custom properties (`var(--accent)`, `var(--border)`, etc.) set via `fill`/`stroke` attributes. Those resolve fine on-screen (the browser has the page's stylesheet), but a serialized `<svg>` opened as a *standalone* file has no access to the page's `:root` variables — colors would render as black. Resolve them to concrete values at export time by reading `getComputedStyle` on the live SVG element before serializing.

```js
// Pure DOM helpers for exporting a live <svg> element (FlowView's flow
// diagram) to a downloadable image. No dependencies — canvas + XMLSerializer
// only, so this works entirely offline like the rest of the static viewer.

// The custom properties FlowView's D3 code references via var(--x) in fill/
// stroke attributes. Resolved to concrete colors before serializing so the
// exported file renders correctly outside the page's own stylesheet context.
const CSS_VARS = ['--accent', '--accent-soft', '--surface', '--border', '--text', '--muted', '--calls'];

function resolveCssVars(svgEl) {
  const computed = getComputedStyle(svgEl);
  const map = {};
  for (const name of CSS_VARS) map[name] = computed.getPropertyValue(name).trim();
  return map;
}

// Returns a standalone SVG string with every var(--x) reference in a fill/
// stroke attribute replaced by its resolved color, and the package-color
// palette (already concrete hex values from PKG_COLORS) left untouched.
export function svgToSvgString(svgEl) {
  const clone = svgEl.cloneNode(true);
  const vars = resolveCssVars(svgEl);
  const varPattern = /var\((--[a-z-]+)\)/g;
  for (const el of clone.querySelectorAll('[fill],[stroke]')) {
    for (const attr of ['fill', 'stroke']) {
      const val = el.getAttribute(attr);
      if (val && val.includes('var(')) {
        el.setAttribute(attr, val.replace(varPattern, (_, name) => vars[name] || '#888'));
      }
    }
  }
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(clone);
}

// Renders the resolved SVG string onto an offscreen canvas at `scale`x and
// returns a PNG data URL. Uses an Image + data:image/svg+xml round-trip
// (no external rasterizer) — the standard no-dependency way to rasterize
// inline SVG in a browser.
export function svgToPngDataUrl(svgEl, scale = 2) {
  const svgString = svgToSvgString(svgEl);
  const width = svgEl.clientWidth || svgEl.viewBox.baseVal.width;
  const height = svgEl.clientHeight || svgEl.viewBox.baseVal.height;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
  });
}
```

- [ ] **Step 2: Build `ExportMenu.svelte`**

```svelte
<script>
  import { svgToSvgString, svgToPngDataUrl } from './export.js';

  export let svgEl = null;
  export let filename = 'flow';

  let openMenu = false;

  function download(href, ext) {
    const a = document.createElement('a');
    a.href = href;
    a.download = `${filename}.${ext}`;
    a.click();
  }

  async function exportPng() {
    if (!svgEl) return;
    const url = await svgToPngDataUrl(svgEl, 2);
    download(url, 'png');
    openMenu = false;
  }

  function exportSvg() {
    if (!svgEl) return;
    const svgString = svgToSvgString(svgEl);
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    download(URL.createObjectURL(blob), 'svg');
    openMenu = false;
  }
</script>

<div class="export-menu">
  <button class="export-btn" title="Export diagram (e)" on:click={() => (openMenu = !openMenu)}>Export ▾</button>
  {#if openMenu}
    <div class="export-dropdown">
      <button on:click={exportPng}>PNG</button>
      <button on:click={exportSvg}>SVG</button>
    </div>
  {/if}
</div>

<style>
  .export-menu { position: relative; }
  .export-btn {
    background: var(--surface-2);
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 10px;
    font-family: var(--vscode-font-family, 'Manrope', sans-serif);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .export-btn:hover { color: var(--accent); border-color: var(--accent); }
  .export-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    z-index: 50;
    overflow: hidden;
  }
  .export-dropdown button {
    display: block;
    width: 100px;
    text-align: left;
    background: none;
    border: none;
    color: var(--text);
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  .export-dropdown button:hover { background: var(--surface-2); }
</style>
```

- [ ] **Step 3: Mount `ExportMenu` in `FlowView.svelte`**

Read `FlowView.svelte`'s full template (past line 120, not shown in earlier exploration) to find where its toolbar/controls currently render, and add the button there positioned near existing flow controls (depth/direction toggles). At minimum, add near the top of the template, exposing `svgEl` which is already declared as a top-of-script `let svgEl;` bound to the `<svg>` element:

```diff
+  import ExportMenu from './ExportMenu.svelte';
```

Add `<ExportMenu {svgEl} filename={root !== null ? DATA.symbols[root][0] : 'flow'} />` in the toolbar area of the template (exact insertion point depends on FlowView's existing toolbar markup — place it alongside the depth-control / direction-toggle buttons so it reads as part of the same control cluster).

- [ ] **Step 4: Add the `e` keyboard shortcut in `App.svelte`**

Since the SVG only exists while `FlowView` is mounted, and `App.svelte` doesn't hold a reference to it, dispatch a `window` custom event instead of calling into `ExportMenu` directly — `ExportMenu` listens for it:

In `App.svelte`'s handler, after the `p` and `?` branches:

```diff
+      if (key === 'e' && get(view) === 'flow') {
+        ev.preventDefault();
+        window.dispatchEvent(new CustomEvent('codegraph:export-flow'));
+        return;
+      }
       if (symId === null) return;
```

In `ExportMenu.svelte`, listen for it via `<svelte:window>`:

```diff
   let openMenu = false;
+
+  function onExportShortcut() { exportPng(); }
```

```diff
+<svelte:window on:codegraph:export-flow={onExportShortcut} />
 <div class="export-menu">
```

(Svelte requires function hoisting order — declare `exportPng` before this `<svelte:window>` binding is evaluated; since Svelte compiles the whole `<script>` block first, function declarations anywhere in the block are fine, but confirm `exportPng` is declared with `async function exportPng()` not a `const` arrow assigned later in the file, to avoid a temporal-dead-zone issue. It already is, per Step 2's code.)

- [ ] **Step 5: Verify manually**

Run: `cd app && npx vite`. Open a flow view. Click "Export ▾" → PNG — a PNG downloads showing the diagram with real colors (not black). Click "Export ▾" → SVG — an SVG file downloads and opens correctly in a browser/image viewer. Press `e` while in flow view — triggers the PNG export directly.

- [ ] **Step 6: Build to confirm no errors**

Run: `cd app && npx vite build`

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/export.js app/src/lib/ExportMenu.svelte app/src/lib/FlowView.svelte app/src/App.svelte
git commit -m "feat: add PNG/SVG export for the flow diagram"
```

---

### Task 7: Git-diff metadata at export time (`--diff <ref>`)

**Files:**
- Modify: `lib/graph.mjs` (`extractGraph()` signature + return value)
- Modify: `bin/codegraph-viz.js` (CLI flag parsing + passthrough)
- Modify: `test/smoke.js` (assert the new field's shape)

**Interfaces:**
- `extractGraph(projectRoot, db, sqliteJson, log, gitDiffRef)` — new 5th optional parameter. When provided (a git ref/range string like `main` or `HEAD~5`), runs `git diff --name-only <gitDiffRef>...HEAD` in `projectRoot` and adds `changedFileIdxs: number[]` to the returned object (indices into the already-built `filesOut` array; files outside the repo/graph are silently dropped). When omitted (existing callers, including `test/smoke.js`'s current call), `changedFileIdxs` is `[]` — fully backward compatible.

- [ ] **Step 1: Read the current `extractGraph` signature and the file-path→index mapping it already builds**

Run: `grep -n "function extractGraph\|filesOut\|pathToIdx\|const fileIdx" lib/graph.mjs` — confirm the exact variable name already mapping a repo-relative path to its index in `filesOut` (there is very likely already a `Map` used while building `fileEdgesOut`/`symbolsOut` from raw DB rows — reuse it rather than building a second one).

- [ ] **Step 2: Add the assertion to `test/smoke.js` first (extending the existing fixture)**

```diff
 const data = extractGraph('/fake/project', '/fake/project/.codegraph/codegraph.db', fakeSqliteJson);
 assert.equal(data.files.length, 2);
 assert.equal(data.symbols.length, 2);
 assert.equal(data.fileEdges.length, 1);
 assert.equal(data.symbolEdges.length, 1);
 assert.deepEqual(data.symbolEdges[0], [0, 1, 1, [1]]);
+
+// changedFileIdxs defaults to [] when no gitDiffRef is passed — must not
+// break existing callers that don't know about the diff feature.
+assert.deepEqual(data.changedFileIdxs, []);
```

- [ ] **Step 3: Run to verify it fails**

Run: `node test/smoke.js`
Expected: `AssertionError` — `data.changedFileIdxs` is `undefined`.

- [ ] **Step 4: Implement the `gitDiffRef` parameter in `lib/graph.mjs`**

Add the Node `child_process` import at the top of the file (check existing imports first — it likely already imports `fs`/`path`; add `execFileSync` alongside):

```diff
 import fs from 'node:fs';
 import path from 'node:path';
+import { execFileSync } from 'node:child_process';
```

Change the function signature:

```diff
-export function extractGraph(projectRoot, db, sqliteJson, log = () => {}) {
+export function extractGraph(projectRoot, db, sqliteJson, log = () => {}, gitDiffRef = null) {
```

Right before the final `return { ... }` (line 268), compute `changedFileIdxsOut` using the same path-to-index lookup the function already has for `filesOut` (the exact reuse point depends on Step 1's finding — if no existing map, build one: `const pathToIdx = new Map(filesOut.map((f, i) => [f[0], i]));`):

```js
  // Git-diff impact overlay support: when a diff ref is given, resolve which
  // already-exported files changed relative to it. Best-effort only — if
  // `git` isn't available or projectRoot isn't a git repo, log and degrade
  // to no changed files rather than failing the whole export.
  let changedFileIdxsOut = [];
  if (gitDiffRef) {
    try {
      const out = execFileSync('git', ['diff', '--name-only', `${gitDiffRef}...HEAD`], {
        cwd: projectRoot,
        encoding: 'utf8',
      });
      const changedPaths = out.split('\n').map(l => l.trim()).filter(Boolean);
      const pathToIdx = new Map(filesOut.map((f, i) => [f[0], i]));
      changedFileIdxsOut = changedPaths
        .map(p => pathToIdx.get(p))
        .filter(idx => idx !== undefined);
    } catch (err) {
      log(`--diff: could not compute git diff against "${gitDiffRef}" (${err.message}); skipping.`);
    }
  }
```

Add `changedFileIdxs: changedFileIdxsOut,` to the returned object, next to `unresolvedImports`:

```diff
     symbolUsageEdges: symbolUsageEdgesOut,
     unresolvedImports: unresolvedImportsOut,
+    changedFileIdxs: changedFileIdxsOut,
     projectMetadata: Object.fromEntries(projectMetadataRaw.map(r => [r.k, r.v])),
```

- [ ] **Step 5: Run the smoke test to verify it passes**

Run: `node test/smoke.js`
Expected: prints its success output (check the file's tail for what it logs on success), exit 0.

- [ ] **Step 6: Add the `--diff <ref>` CLI flag in `bin/codegraph-viz.js`**

Find the existing CLI option-parsing block (likely a small hand-rolled `for` loop over `process.argv`, given the file's size) and the `extractGraph(...)` call site at line 149. Add a `--diff` flag alongside whatever pattern the existing flags use (read the file's option-parsing section first to match its exact style — e.g. if it uses a `opts` object populated by a switch on `process.argv`), then thread it through:

```diff
-const data = extractGraph(projectRoot, db, sqliteJson, log);
+const data = extractGraph(projectRoot, db, sqliteJson, log, opts.diff || null);
```

Add `--diff <ref>` to whatever help/usage text the CLI prints (`--help` output), documenting: `--diff <ref>   Mark files changed since <ref> (e.g. main, HEAD~5) for the diff-impact overlay`.

- [ ] **Step 7: Manual end-to-end check**

In a real git repo with a `.codegraph/` index, run: `node bin/codegraph-viz.js --diff main` (or whatever the actual CLI invocation pattern is per its own `--help`) and confirm the generated `dist/index.html`'s embedded `window.__GRAPH_DATA__.changedFileIdxs` is a non-empty array when there are uncommitted/branch changes relative to `main`. Skip this step gracefully (note it as "not verified — no diff available in a clean checkout") if the working tree has no diff against `main` to exercise.

- [ ] **Step 8: Commit**

```bash
git add lib/graph.mjs bin/codegraph-viz.js test/smoke.js
git commit -m "feat: add --diff CLI flag to export changed-file metadata"
```

---

### Task 8: Diff/blast-radius overlay in the UI

**Files:**
- Create: `app/src/lib/DiffToggle.svelte`
- Modify: `app/src/lib/stores.js` (add `diffOverlayOn`, `changedSymIds`, `blastRadiusSymIds` derived state)
- Modify: `app/src/lib/Header.svelte` (mount `DiffToggle`, hide it entirely when there's no diff data)
- Modify: `app/src/lib/FlowView.svelte` (color nodes by changed/affected/unrelated when the overlay is on)
- Modify: `app/src/App.svelte` (add `d` shortcut)

**Interfaces:**
- Consumes: `DATA.changedFileIdxs` (Task 7), `DATA.fileSymbolIds`, `blastRadius()` (Task 1).
- Produces: `diffOverlayOn` writable boolean; `changedSymIds` and `blastRadiusSymIds` as plain derived `Set<number>` computed once (not stores, since `DATA` never changes after load — same rationale as `deadCodeSymbols`/`cycleGroups` being computed once in `stores.js`).

- [ ] **Step 1: Compute the changed/affected symbol sets once in `stores.js`**

After the existing `deadCodeSymbols`/`cycleGroups` block at the bottom of `stores.js`:

```diff
 import { loadGraphData, buildAdjacency, findDeadCode, findCycles } from './graph.js';
+import { blastRadius } from './graph.js';
```

```js
// ---------- git-diff impact overlay ----------
// Only meaningful when the export was run with `--diff <ref>` (Task 7);
// DATA.changedFileIdxs is [] otherwise, in which case both sets below are
// empty and DiffToggle hides itself entirely (see DiffToggle.svelte).
export const diffOverlayOn = writable(false);
export const changedSymIds = new Set(
  (DATA.changedFileIdxs || []).flatMap(fileIdx => DATA.fileSymbolIds[fileIdx] || [])
);
export const blastRadiusSymIds = blastRadius([...changedSymIds], symInAdj);
export const hasDiffData = changedSymIds.size > 0;
```

Place this block after `symInAdj`/`symOutAdj` are defined (it depends on `symInAdj`) but it can go anywhere after that — put it right before the `deadCodeSymbols.set(...)` line at the bottom so it reads as part of the same "precomputed once" section.

- [ ] **Step 2: Build `DiffToggle.svelte`**

```svelte
<script>
  import { diffOverlayOn, hasDiffData, changedSymIds, blastRadiusSymIds } from './stores.js';
</script>

{#if hasDiffData}
  <button
    class="diff-toggle"
    class:active={$diffOverlayOn}
    title="Toggle git-diff impact overlay (d)"
    on:click={() => diffOverlayOn.update(v => !v)}
  >
    <span class="dot changed"></span>{changedSymIds.size} changed
    <span class="dot affected"></span>{blastRadiusSymIds.size - changedSymIds.size} affected
  </button>
{/if}

<style>
  .diff-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--surface-2);
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 10px;
    font-family: var(--vscode-font-family, 'Manrope', sans-serif);
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    margin-right: 12px;
  }
  .diff-toggle.active { color: var(--text); border-color: var(--accent); }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 2px; }
  .dot.changed { background: #c94f7c; }
  .dot.affected { background: #c9a13f; }
</style>
```

- [ ] **Step 3: Mount `DiffToggle` in `Header.svelte`**

```diff
+  import DiffToggle from './DiffToggle.svelte';
```

```diff
   <div class="spacer"></div>
+  <DiffToggle />
   <button class="find-path-btn" title="Find path between two symbols (p)" on:click={() => pathFinderOpen.set(true)}>⇄ Find path</button>
```

- [ ] **Step 4: Color FlowView nodes by diff status when the overlay is active**

In `FlowView.svelte`, import the new state:

```diff
-  import { DATA, symOutAdj, symInAdj, flowRoot, flowDirection, flowDepth, flowFeatureFilter, packageFilter, flowTrail, tooltipState } from './stores.js';
+  import { DATA, symOutAdj, symInAdj, flowRoot, flowDirection, flowDepth, flowFeatureFilter, packageFilter, flowTrail, tooltipState, diffOverlayOn, changedSymIds, blastRadiusSymIds } from './stores.js';
```

In `drawTree`, the node `rect`'s `fill`/`stroke` currently branch only on `d.depth === 0`. Layer the diff coloring on top when the overlay is on — read `$diffOverlayOn` at the top of `drawTree` (it's called reactively from `$: if (treeData && gEl && zoomBehavior) drawTree(treeData);`, so add the store to that reactive statement's dependencies by referencing it inside `drawTree`, which Svelte's compiler picks up automatically since `drawTree` is called from a `$:` block — no extra wiring needed beyond reading `$diffOverlayOn` inside the function body):

```diff
   function drawTree(data) {
+    const overlayOn = $diffOverlayOn;
     const hierarchy = d3.hierarchy(data, d => d.children);
```

```diff
     node.append('rect').attr('width', NODE_W).attr('height', NODE_H).attr('rx', 8)
-      .attr('fill', d => d.depth === 0 ? 'var(--accent-soft)' : 'var(--surface)')
-      .attr('stroke', d => d.depth === 0 ? 'var(--accent)' : pkgColor(d.data.pkgIdx))
+      .attr('fill', d => d.depth === 0 ? 'var(--accent-soft)' : 'var(--surface)')
+      .attr('stroke', d => {
+        if (overlayOn && changedSymIds.has(d.data.symId)) return '#c94f7c';
+        if (overlayOn && blastRadiusSymIds.has(d.data.symId)) return '#c9a13f';
+        return d.depth === 0 ? 'var(--accent)' : pkgColor(d.data.pkgIdx);
+      })
       .attr('stroke-width', d => d.depth === 0 ? 2 : 1);
```

(As with Task 2 Step 4, confirm the actual field name `buildFlowTree` uses for a node's symbol id — `d.data.symId` here must match what Task 2 used.)

- [ ] **Step 5: Add the `d` keyboard shortcut in `App.svelte`**

```diff
-    packageFilter, symbolKindFilter, pathFinderOpen, shortcutsHelpOpen,
+    packageFilter, symbolKindFilter, pathFinderOpen, shortcutsHelpOpen, diffOverlayOn,
```

```diff
       if (key === 'e' && get(view) === 'flow') {
         ev.preventDefault();
         window.dispatchEvent(new CustomEvent('codegraph:export-flow'));
         return;
       }
+      if (key === 'd') {
+        ev.preventDefault();
+        diffOverlayOn.update(v => !v);
+        return;
+      }
       if (symId === null) return;
```

- [ ] **Step 6: Verify manually (two scenarios)**

*Without diff data* (default sample data / no `--diff` flag used at export): run `cd app && npx vite` — confirm `DiffToggle` renders nothing (no button in the header), and pressing `d` is a silent no-op (the store toggles but nothing observably changes since `hasDiffData` is false and no view reads `blastRadiusSymIds` visibly — acceptable, since the header button itself never appeared to invite the keypress in the first place).

*With diff data*: temporarily hardcode `DATA.changedFileIdxs = [1]` in a browser devtools console after load (since generating a real `--diff` export requires a full CodeGraph-indexed repo, this is the fastest manual check) — confirm the header button appears with correct counts, clicking it or pressing `d` recolors flow-view nodes (pink border = changed, yellow border = affected), and clicking again reverts to normal package coloring.

- [ ] **Step 7: Build to confirm no errors**

Run: `cd app && npx vite build`

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/DiffToggle.svelte app/src/lib/stores.js app/src/lib/Header.svelte app/src/lib/FlowView.svelte app/src/App.svelte
git commit -m "feat: add git-diff impact overlay to flow view"
```

---

### Task 9: Overview / Deep-dive density toggle for the detail panel

**Files:**
- Modify: `app/src/lib/stores.js` (add `detailMode`)
- Modify: `app/src/lib/Sidebar.svelte` (add the toggle control — check its current top-level layout first to find where a small persistent control belongs, since it's the one component always visible regardless of `view`)
- Modify: `app/src/lib/DetailPanel.svelte` (gate the "advanced" fields behind `detailMode === 'deepdive'`)

**Interfaces:**
- Produces: `detailMode` writable, `'overview' | 'deepdive'`, persisted to `localStorage` (mirrors the existing `namedFlows` persistence pattern in `stores.js:43-54`) so the choice survives reloads — this is a display preference, not per-project data, so it's fine to persist globally rather than scoped by project root.

**Note on scope vs. understand-anything's "Persona Selector":** their version has a third "Learn" mode backed by LLM-authored tour content, which doesn't exist in this static tool and isn't part of this plan. This task ports only the "control how much detail shows" half of that feature — a straightforward density toggle, not a tour system.

- [ ] **Step 1: Add the persisted `detailMode` store**

In `stores.js`, near the `namedFlows` persistence block (reuse the same load/save pattern):

```js
// ---------- detail panel density ----------
// 'overview' hides advanced/structural fields (decorators, type params,
// qualified name, raw parsed signature, visibility/static/abstract flags)
// so a first-time reader isn't confronted with everything at once.
// 'deepdive' shows all of it. Persisted globally (not per-project) since
// it's a reading preference, not project data.
const DETAIL_MODE_KEY = 'codegraph-detail-mode';
function loadDetailMode() {
  if (typeof localStorage === 'undefined') return 'overview';
  try { return localStorage.getItem(DETAIL_MODE_KEY) || 'overview'; }
  catch { return 'overview'; }
}
export const detailMode = writable(loadDetailMode());
detailMode.subscribe(v => {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(DETAIL_MODE_KEY, v); } catch { /* quota */ }
});
```

- [ ] **Step 2: Read Sidebar.svelte's current top-of-template layout**

Run: `sed -n '1,40p' app/src/lib/Sidebar.svelte` to find its outermost wrapper and any existing header-row-like element (the unused `.panel-title-row` CSS selector vite build warned about earlier suggests one may already exist but be unused — check whether it's dead CSS to reuse or truly vestigial before adding a new one).

- [ ] **Step 3: Add the toggle control**

Add near the top of `Sidebar.svelte`'s template (exact placement depends on Step 2's finding):

```svelte
<div class="detail-mode-toggle">
  <button class:active={$detailMode === 'overview'} on:click={() => detailMode.set('overview')}>Overview</button>
  <button class:active={$detailMode === 'deepdive'} on:click={() => detailMode.set('deepdive')}>Deep-dive</button>
</div>
```

```diff
-  import { ... } from './stores.js';
+  import { ..., detailMode } from './stores.js';
```

```css
  .detail-mode-toggle {
    display: flex;
    gap: 2px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 2px;
    margin-bottom: 8px;
  }
  .detail-mode-toggle button {
    flex: 1;
    background: none;
    border: none;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 11px;
    color: var(--muted);
    cursor: pointer;
  }
  .detail-mode-toggle button.active { background: var(--surface); color: var(--text); }
```

- [ ] **Step 4: Gate advanced fields in `DetailPanel.svelte`**

Import the store:

```diff
-  import { DATA, selectedFile, selectedSymbol, fileInAdj, fileOutAdj, symInAdj, symOutAdj, symUsageInAdj } from './stores.js';
+  import { DATA, selectedFile, selectedSymbol, fileInAdj, fileOutAdj, symInAdj, symOutAdj, symUsageInAdj, detailMode } from './stores.js';
```

Wrap the existing qualified-name block, decorator row, and flag row (currently always shown when the underlying data exists — `DetailPanel.svelte:106-134` from Task 2's earlier read) so they only render in deep-dive mode:

```diff
-    {#if qualifiedName}
+    {#if qualifiedName && $detailMode === 'deepdive'}
       <div class="qualified-name mono" title="Fully qualified name">{qualifiedName}</div>
     {/if}
```

```diff
-    {#if decorators.length > 0}
+    {#if decorators.length > 0 && $detailMode === 'deepdive'}
       <div class="decorator-row mono">
         {#each decorators as d}<span class="decorator-chip">@{d}</span>{/each}
       </div>
     {/if}
```

```diff
-    {#if visibility || isAsync || isStatic || isAbstract || realReturnType || typeParameters.length > 0}
+    {#if $detailMode === 'deepdive' && (visibility || isAsync || isStatic || isAbstract || realReturnType || typeParameters.length > 0)}
       <div class="flag-row">
```

```diff
-    {#if realSignature && realSignature !== symbol[0]}
+    {#if $detailMode === 'deepdive' && realSignature && realSignature !== symbol[0]}
       <div class="real-sig mono" title="Signature as parsed by CodeGraph">{realSignature}</div>
     {/if}
```

Leave everything else (doc, params/fields table, complexity/reach, source, callers/callees/tests, the Task 2 pkg badge, and the Task-earlier dead-code pill) visible in both modes — those are the "what is this and does anything use it" essentials, not structural minutiae.

- [ ] **Step 5: Verify manually**

Run: `cd app && npx vite`. Select a symbol that has decorators/type params/qualified name (or check the sample data's `CoreService`/`Widget` — extend the sample data temporarily in `graph.js:823` if none of it has these fields, just for this manual check, then revert). Confirm "Overview" hides those fields and "Deep-dive" shows them. Reload the page — confirm the last-picked mode persists.

- [ ] **Step 6: Build to confirm no errors**

Run: `cd app && npx vite build`

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/stores.js app/src/lib/Sidebar.svelte app/src/lib/DetailPanel.svelte
git commit -m "feat: add overview/deep-dive density toggle for detail panel"
```

---

## Self-Review Notes

- **Spec coverage:** all 6 high-value items (hover tooltip, path finder, inline/expandable source viewer, keyboard shortcuts help, PNG/SVG export) and both medium-value items (diff/blast-radius overlay, persona→density toggle) from the prior conversation each map to one task (Tasks 2–9; Task 1 is shared infra for Tasks 2, 3, and 8).
- **Static/no-LLM constraint:** Task 7 is the only task touching the export pipeline, and it only shells out to local `git` — no network or model calls anywhere in the plan.
- **Placeholder scan:** every step has real code; the two steps that say "read X before writing the diff" (Task 2 Step 4, Task 8 Step 4, Task 7 Step 1, Task 9 Step 2) are legitimate — they depend on exact field/variable names in files this plan's author couldn't fully re-verify line-by-line for every internal helper without re-reading the whole codebase, and are flagged precisely so the implementer confirms before typing the diff, not left vague about *what* to do.
- **Type/name consistency:** `d.data.symId` (Task 2, Task 8) must match whatever `buildFlowTree` actually names it — both tasks reference the same open question so a single check resolves both. `shortestPath`/`blastRadius` signatures (Task 1) match their call sites in Tasks 3 and 8 exactly (`(fromId, toId, symOutAdj, symInAdj)` and `(changedSymIds, symInAdj)`).
