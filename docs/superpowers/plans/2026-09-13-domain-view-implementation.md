# Domain View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a client-only "domain view" (`view === 'domains'`) that groups packages into coarse business/feature domains by folder-depth truncation, lists each domain's detected entry points, and previews a short linear call chain per entry point — zero new export-time computation, zero LLM/network calls, zero new npm dependencies.

**Architecture:** Two new pure helper functions in `app/src/lib/graph.js` (`groupPackagesByDepth`, `previewChain`), one new ephemeral store (`domainDepth`) in `app/src/lib/stores.js`, one new Svelte view (`DomainView.svelte`) that reuses `isEntryPoint` (entry-point detection) and the existing `symOutAdj` adjacency (call-chain walking) already built in `stores.js`, wired into `App.svelte`'s flat `{#if $view === '...'}` chain and a new toggle button in `Sidebar.svelte`'s "Views" section.

**Tech Stack:** Svelte 4 (no TypeScript), plain-Node `assert`-based smoke tests (no test framework), Vite build.

**Spec:** `docs/superpowers/specs/2026-09-13-domain-view-design.md`

## Global Constraints

- No changes to `lib/graph.mjs`, `bin/codegraph-viz.js`, or `test/smoke.js` — zero new export-time computation.
- No new npm dependencies.
- No LLM-authored names or descriptions anywhere in this feature.
- `domainDepth` is NOT persisted to `localStorage` (unlike `detailMode`) — it's session-ephemeral.
- Entry-point detection MUST reuse `isEntryPoint()` from `app/src/lib/graph.js:666` verbatim — no second heuristic.
- `previewChain` is a single linear greedy walk (first outgoing edge only), NOT a branching tree like `buildFlowTree`.

---

### Task 1: Pure helper functions in `graph.js`

**Files:**
- Modify: `app/src/lib/graph.js:95` (insert after `filesInPkg`, before `buildFlowTree`)
- Modify: `app/src/lib/graph.js` (insert `previewChain` after `enumerateAllPaths`, before `isEntryPoint` at line 666 — exact insertion point confirmed once `enumerateAllPaths`'s full body is visible in the editor, but placement relative to `isEntryPoint` is what matters, not the exact line)
- Test: `test/graph-client-smoke.js`

**Interfaces:**
- Produces: `groupPackagesByDepth(packages, depth) -> Map<string, number[]>` — `packages` is `DATA.packages` (`[name, fileCount, symbolCount][]`); returns domain name -> array of package indices.
- Produces: `previewChain(rootId, symOutAdj, maxHops = 4) -> number[]` — ordered symId chain inclusive of `rootId`.
- Consumes: nothing new — `symOutAdj` is the existing `Map<symId, [calleeSymId, weight][]>` produced by `buildAdjacency` (already in `stores.js`).

- [ ] **Step 1: Write the failing tests**

Append to `test/graph-client-smoke.js`:

```javascript
import { groupPackagesByDepth, previewChain } from '../app/src/lib/graph.js';

// groupPackagesByDepth: truncates package path to `depth` segments and groups indices
const packages = [
  ['app/src/lib', 3, 10],      // 0
  ['app/src/components', 2, 5], // 1
  ['backend/api', 4, 20],       // 2
  ['root', 1, 1],               // 3 (shorter than depth — groups under its own full name)
];
const depth2 = groupPackagesByDepth(packages, 2);
assert.deepEqual([...depth2.keys()].sort(), ['app/src', 'backend/api', 'root']);
assert.deepEqual(depth2.get('app/src').sort((a, b) => a - b), [0, 1]);
assert.deepEqual(depth2.get('backend/api'), [2]);
assert.deepEqual(depth2.get('root'), [3]);

const depth1 = groupPackagesByDepth(packages, 1);
assert.deepEqual([...depth1.keys()].sort(), ['app', 'backend', 'root']);
assert.deepEqual(depth1.get('app').sort((a, b) => a - b), [0, 1]);

// previewChain: linear greedy walk along the first outgoing edge, using the same
// 0 -> 1 -> 2 -> 3, 4 -> 1, 5 isolated fixture graph as above
assert.deepEqual(previewChain(0, out, 4), [0, 1, 2, 3]);
assert.deepEqual(previewChain(0, out, 2), [0, 1, 2]); // hop cap
assert.deepEqual(previewChain(5, out, 4), [5]); // no outgoing edges
assert.deepEqual(previewChain(3, out, 4), [3]); // leaf node

// previewChain: cycle guard stops the walk even though the hop cap alone would too
const { out: cyclicOut } = buildAdjacency([[10, 11, 1], [11, 10, 1]]);
assert.deepEqual(previewChain(10, cyclicOut, 4), [10, 11]);

console.log('graph-client-smoke: OK (domain view helpers)');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/graph-client-smoke.js`
Expected: FAIL — `groupPackagesByDepth is not a function` (or similar import error), since neither function exists yet.

- [ ] **Step 3: Implement `groupPackagesByDepth`**

Insert into `app/src/lib/graph.js` immediately after `filesInPkg` (after line 95, before `const FLOW_MAX_CHILDREN = 12;`):

```javascript
// Groups package indices into coarse "domains" by truncating each package's
// `/`-separated path to `depth` segments. E.g. at depth 2, `app/src/lib` and
// `app/src/components` both truncate to `app/src` and group together. A
// package with fewer than `depth` segments groups under its own full name
// (truncation is a no-op once you run out of segments).
export function groupPackagesByDepth(packages, depth) {
  const groups = new Map();
  packages.forEach(([name], i) => {
    const prefix = name.split('/').slice(0, depth).join('/');
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(i);
  });
  return groups;
}
```

- [ ] **Step 4: Implement `previewChain`**

Insert into `app/src/lib/graph.js` immediately before the `isEntryPoint` function (before line 666, i.e. right after `enumerateAllPaths` ends):

```javascript
// A short, deliberately LINEAR (not branching) greedy walk from `rootId`:
// repeatedly follows the FIRST outgoing edge in `symOutAdj.get(id)` (same
// adjacency shape buildAdjacency produces), stopping at `maxHops` steps, at
// a node with no outgoing edges, or upon revisiting an already-visited symId
// (cycle guard — belt-and-suspenders alongside the hop cap, which alone
// already bounds the walk). This is intentionally NOT buildFlowTree, which
// produces a full branching tree — this produces one flat preview path.
export function previewChain(rootId, symOutAdj, maxHops = 4) {
  const chain = [rootId];
  const visited = new Set([rootId]);
  let current = rootId;
  for (let i = 0; i < maxHops; i++) {
    const edges = symOutAdj.get(current);
    if (!edges || edges.length === 0) break;
    const next = edges[0][0];
    if (visited.has(next)) break;
    chain.push(next);
    visited.add(next);
    current = next;
  }
  return chain;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node test/graph-client-smoke.js`
Expected: PASS — prints `graph-client-smoke: OK` and `graph-client-smoke: OK (domain view helpers)` with no assertion errors.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/graph.js test/graph-client-smoke.js
git commit -m "feat: add groupPackagesByDepth and previewChain pure helpers"
```

---

### Task 2: `domainDepth` store

**Files:**
- Modify: `app/src/lib/stores.js` (add near `detailMode`, in the navigation section)

**Interfaces:**
- Consumes: nothing.
- Produces: `domainDepth` — a Svelte `writable(2)`, exported from `stores.js`. NOT persisted to localStorage (ephemeral, unlike `detailMode`).

- [ ] **Step 1: Add the store**

In `app/src/lib/stores.js`, immediately after the `export const view = writable('packages');` / `currentPkg` block (around line 113-115), add:

```javascript
// ---------- domain view ----------
// Folder-depth used to group packages into coarse "domains" (see
// groupPackagesByDepth in graph.js). Ephemeral — NOT persisted to
// localStorage, unlike detailMode: this is an exploratory dial re-adjusted
// per repo/session, not a stable reading preference.
export const domainDepth = writable(2);
```

- [ ] **Step 2: Verify the app still builds**

Run: `cd app && npx vite build`
Expected: succeeds with the same warnings as before this change (no new errors — `domainDepth` isn't consumed anywhere yet, so nothing else should change).

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/stores.js
git commit -m "feat: add ephemeral domainDepth store"
```

---

### Task 3: `DomainView.svelte`

**Files:**
- Create: `app/src/lib/DomainView.svelte`

**Interfaces:**
- Consumes: `DATA`, `symOutAdj`, `symInAdj`, `domainDepth` (from `stores.js`); `groupPackagesByDepth`, `previewChain`, `isEntryPoint`, `pkgColor`, `displayName` (from `graph.js`); `selectSymbol`, `openFlow` (from `actions.js`).
- Produces: `DomainView` component, no props, no exports consumed elsewhere in this task (wired into `App.svelte` in Task 4).

- [ ] **Step 1: Write the component**

Create `app/src/lib/DomainView.svelte`:

```svelte
<script>
  // Groups packages into coarse business/feature "domains" by folder-depth
  // truncation, lists each domain's detected entry points, and previews a
  // short linear call chain per entry point. Purely structural — no LLM, no
  // new export-time data. See docs/superpowers/specs/2026-09-13-domain-view-design.md.
  import { DATA, symOutAdj, symInAdj, domainDepth } from './stores.js';
  import { selectSymbol, openFlow } from './actions.js';
  import { groupPackagesByDepth, previewChain, isEntryPoint, pkgColor, displayName } from './graph.js';

  const MAX_HOPS = 4;

  let selectedDomain = null; // domain name string, or null
  let query = '';
  let kindOverride = null; // local kind-chip filter, same pattern as EntryPointsView

  $: domains = [...groupPackagesByDepth(DATA.packages, $domainDepth).entries()]
    .map(([name, pkgIdxs]) => ({ name, pkgIdxs, pkgCount: pkgIdxs.length }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Keep a valid selection across depth changes: fall back to the first
  // domain if the previously selected one no longer exists, or pick the
  // first domain on initial load.
  $: if (domains.length && !domains.some((d) => d.name === selectedDomain)) {
    selectedDomain = domains[0].name;
  }

  $: currentDomain = domains.find((d) => d.name === selectedDomain) || null;

  $: entryPoints = (() => {
    if (!currentDomain) return [];
    const pkgSet = new Set(currentDomain.pkgIdxs);
    const out = [];
    for (let i = 0; i < DATA.symbols.length; i++) {
      const s = DATA.symbols[i];
      const f = DATA.files[s[4]];
      if (!pkgSet.has(f[1])) continue;
      const inDeg = (symInAdj.get(i) || []).length;
      if (!isEntryPoint(s, s[5] || '', inDeg)) continue;
      out.push({
        symId: i,
        name: s[0],
        kind: s[1],
        filePath: f[0],
        startLine: s[2],
        chain: previewChain(i, symOutAdj, MAX_HOPS),
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  })();

  $: filtered = (() => {
    const q = query.trim().toLowerCase();
    return entryPoints.filter((e) => {
      if (kindOverride && !kindOverride.has(e.kind)) return false;
      if (q && !e.name.toLowerCase().includes(q) && !e.filePath.toLowerCase().includes(q)) return false;
      return true;
    });
  })();

  $: availableKinds = [...new Set(entryPoints.map((e) => e.kind))].sort();

  function stepDepth(delta) {
    domainDepth.update((d) => Math.max(1, d + delta));
  }

  // Resolves a symId in a preview chain to display metadata.
  function symbolMeta(symId) {
    const s = DATA.symbols[symId];
    const f = DATA.files[s[4]];
    return { name: s[0], kind: s[1], filePath: f[0], pkgIdx: f[1] };
  }
</script>

<div class="domain-view">
  <div class="domain-rail">
    <div class="rail-head">
      <span class="section-title">Domains</span>
      <div class="depth-stepper">
        <button class="step-btn" on:click={() => stepDepth(-1)} disabled={$domainDepth <= 1}>−</button>
        <span class="depth-val">depth {$domainDepth}</span>
        <button class="step-btn" on:click={() => stepDepth(1)}>+</button>
      </div>
    </div>
    <div class="rail-list">
      {#each domains as d (d.name)}
        <button class="rail-item" class:active={selectedDomain === d.name} on:click={() => (selectedDomain = d.name)}>
          <span class="rail-name mono">{d.name}</span>
          <span class="rail-count">{d.pkgCount} pkg{d.pkgCount === 1 ? '' : 's'}</span>
        </button>
      {/each}
      {#if domains.length === 0}
        <div class="empty">No packages found.</div>
      {/if}
    </div>
  </div>

  <div class="domain-main">
    {#if currentDomain}
      <div class="head">
        <div>
          <h1 class="mono">{currentDomain.name}</h1>
          <p class="sub">{entryPoints.length} entry point{entryPoints.length === 1 ? '' : 's'} across {currentDomain.pkgCount} package{currentDomain.pkgCount === 1 ? '' : 's'}.</p>
        </div>
        {#if entryPoints.length > 0}
          <div class="head-controls">
            <input type="text" placeholder="Filter by name or file…" bind:value={query} />
            <div class="kind-mini">
              {#each availableKinds as k (k)}
                <button
                  class="kind-mini-btn"
                  class:active={kindOverride && kindOverride.has(k)}
                  on:click={() => kindOverride = kindOverride && kindOverride.has(k)
                    ? (kindOverride.delete(k), kindOverride.size ? kindOverride : null)
                    : new Set([k])}
                >{k}</button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
      <div class="entries">
        {#if entryPoints.length === 0}
          <div class="empty">No entry points detected in this domain.</div>
        {:else if filtered.length === 0}
          <div class="empty">No entry points match the current filters.</div>
        {:else}
          {#each filtered as e (e.symId)}
            <div class="entry-card">
              <button class="entry-head" on:click={() => openFlow(e.symId, 'out')} title={e.filePath}>
                <span class="entry-name mono">{e.name}</span>
                <span class="entry-kind">{e.kind}</span>
                <span class="entry-file mono muted">{displayName(e.filePath)}<span class="line">:{e.startLine}</span></span>
              </button>
              <div class="chain">
                {#each e.chain as symId, i (symId)}
                  {@const m = symbolMeta(symId)}
                  <button class="chain-step" on:click={() => selectSymbol(symId)}>
                    <span class="step-badge">{i + 1}</span>
                    <span class="step-dot" style="background:{pkgColor(m.pkgIdx)}"></span>
                    <span class="step-info">
                      <span class="step-name mono">{m.name}</span>
                      <span class="step-meta muted">{m.kind} · {displayName(m.filePath)}</span>
                    </span>
                  </button>
                  {#if i < e.chain.length - 1}<div class="chain-connector">↓</div>{/if}
                {/each}
              </div>
            </div>
          {/each}
        {/if}
      </div>
    {:else}
      <div class="empty">No domain selected.</div>
    {/if}
  </div>
</div>

<style>
  .domain-view {
    position: absolute;
    inset: 0;
    display: flex;
    font-family: var(--vscode-font-family, 'Manrope', sans-serif);
    color: var(--text);
  }
  .mono { font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); }
  .muted { color: var(--muted); }

  .domain-rail {
    width: 240px;
    flex: 0 0 auto;
    border-right: 1px solid var(--border);
    background: var(--surface);
    display: flex;
    flex-direction: column;
  }
  .rail-head {
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .section-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
  .depth-stepper { display: flex; align-items: center; gap: 6px; }
  .step-btn {
    background: var(--surface-2); color: var(--text); border: 1px solid var(--border);
    border-radius: 4px; width: 20px; height: 20px; line-height: 1; cursor: pointer; font-size: 13px;
  }
  .step-btn:disabled { opacity: 0.35; cursor: default; }
  .step-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .depth-val { font-size: 10.5px; color: var(--muted); font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); }

  .rail-list { overflow-y: auto; flex: 1; padding: 8px; display: flex; flex-direction: column; gap: 4px; }
  .rail-item {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    background: none; border: 1px solid transparent; border-radius: 6px;
    padding: 8px 10px; cursor: pointer; text-align: left; color: var(--text);
  }
  .rail-item:hover { background: var(--surface-2); }
  .rail-item.active { background: var(--accent-soft); border-color: var(--accent); }
  .rail-name { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rail-count { flex: 0 0 auto; font-size: 10px; color: var(--muted); }

  .domain-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
  .head {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
    padding: 14px 18px; border-bottom: 1px solid var(--border); background: var(--surface);
  }
  .head h1 { margin: 0; font-size: 16px; }
  .head .sub { margin: 4px 0 0 0; color: var(--muted); font-size: 12px; }
  .head-controls { display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
  .head input {
    background: var(--surface-2); border: 1px solid var(--border); color: var(--text);
    border-radius: 6px; padding: 6px 10px; font-family: inherit; font-size: 12.5px; width: 220px; outline: none;
  }
  .head input:focus { border-color: var(--accent); }
  .kind-mini { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
  .kind-mini-btn {
    background: var(--surface-2); color: var(--muted); border: 1px solid var(--border);
    border-radius: 12px; padding: 2px 8px; font-size: 10px; font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); cursor: pointer;
  }
  .kind-mini-btn:hover { color: var(--text); border-color: var(--accent); }
  .kind-mini-btn.active { background: var(--accent); color: white; border-color: var(--accent); }

  .entries { overflow-y: auto; flex: 1; padding: 12px 18px 18px; display: flex; flex-direction: column; gap: 12px; }
  .entry-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
  .entry-head {
    display: flex; align-items: baseline; gap: 10px; width: 100%; background: none; border: none; padding: 0 0 8px 0;
    cursor: pointer; text-align: left; border-bottom: 1px solid var(--border); margin-bottom: 8px;
  }
  .entry-name { font-size: 13px; font-weight: 700; color: var(--accent); }
  .entry-head:hover .entry-name { text-decoration: underline; }
  .entry-kind { font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .entry-file { font-size: 11px; margin-left: auto; }
  .entry-file .line { color: var(--accent); }

  .chain { display: flex; flex-direction: column; }
  .chain-step {
    display: flex; align-items: center; gap: 10px; width: 100%; box-sizing: border-box; text-align: left;
    background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; cursor: pointer;
  }
  .chain-step:hover { border-color: var(--accent); background: var(--accent-soft); }
  .step-badge {
    flex: 0 0 auto; width: 18px; height: 18px; border-radius: 50%; background: var(--accent-soft); color: var(--accent);
    font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center;
  }
  .step-dot { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; }
  .step-info { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .step-name { font-size: 12px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .step-meta { font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chain-connector { text-align: center; color: var(--muted); font-size: 11px; line-height: 1.3; }

  .empty { padding: 30px; text-align: center; color: var(--muted); font-size: 13px; }
</style>
```

- [ ] **Step 2: Verify the app builds**

Run: `cd app && npx vite build`
Expected: succeeds, no new warnings beyond the 4 already-accepted `Modal.svelte` a11y warnings (this component isn't imported anywhere yet, so it's dead code from the bundler's view but must still parse/compile cleanly — Vite compiles every `.svelte` file it can reach; if it's not reached yet because nothing imports it, this step becomes a no-op check and the real verification happens in Task 4 once it's wired in. Either way, run it now to catch syntax errors early.)

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/DomainView.svelte
git commit -m "feat: add DomainView component"
```

---

### Task 4: Wire into `Sidebar.svelte` and `App.svelte`

**Files:**
- Modify: `app/src/lib/Sidebar.svelte`
- Modify: `app/src/App.svelte`

**Interfaces:**
- Consumes: `DomainView` (Task 3), `domainDepth` (Task 2), `groupPackagesByDepth` (Task 1).

- [ ] **Step 1: Add the toggle button in `Sidebar.svelte`**

In `app/src/lib/Sidebar.svelte`, add `domainDepth` to the `stores.js` import (alongside `detailMode` on line 9) and `groupPackagesByDepth` to the `graph.js` import (alongside `isEntryPoint` on line 16):

```javascript
  import {
    DATA, view, isolate, hop, direction, showImports, showCalls, searchQuery,
    flowRoot, flowDirection, flowDepth, flowTrail, flowFeatureFilter,
    symOutAdj, symInAdj, packageFilter, symUsageInAdj,
    symbolKindFilter, deadCodeSymbols, detailMode, domainDepth,
  } from './stores.js';
```

```javascript
  import { pkgColor, shortPkg, displayName, featureGroup, isEntryPoint, groupPackagesByDepth } from './graph.js';
```

Add a reactive domain count near the other nav-button counts (after `entryPointCount`, around line 40):

```javascript
  // Count of distinct domains at the current domainDepth, for the sidebar nav button.
  $: domainCount = groupPackagesByDepth(DATA.packages, $domainDepth).size;
```

Add the toggle button at the end of the "Views" section body, immediately before the closing `</div>` of `section-body` (after the "Index health" button, around line 348):

```svelte
        <button
          class="legend-item"
          class:active={$view === 'domains'}
          title="Business/feature domains grouped by folder depth, with entry points and call-chain previews"
          on:click={() => view.set($view === 'domains' ? 'packages' : 'domains')}
        >
          <span class="swatch" style="background:#5b5ed6"></span>
          <span>Domains</span>
          <span class="count">{domainCount}</span>
        </button>
```

- [ ] **Step 2: Wire the view in `App.svelte`**

In `app/src/App.svelte`, add the import (alongside `IndexHealthView` on line 27):

```javascript
  import DomainView from './lib/DomainView.svelte';
```

Add a hint-text branch (alongside the `indexHealth` branch, around line 55, before the final `: 'Click a node...'` default):

```javascript
    : $view === 'domains'
    ? 'Business/feature domains grouped by folder depth &middot; click an entry point to open its full flow, or any step in its preview chain to inspect that symbol.'
    : 'Click a node to make it the new root &middot; scroll to zoom &middot; drag to pan.';
```

Add the view branch (alongside the `indexHealth` branch, around line 182, before the final `{:else}`):

```svelte
    {:else if $view === 'domains'}
      <DomainView />
```

- [ ] **Step 3: Verify the app builds**

Run: `cd app && npx vite build`
Expected: succeeds, no new warnings beyond the 4 already-accepted `Modal.svelte` a11y warnings.

- [ ] **Step 4: Manual dev-server check**

Run: `cd app && npx vite dev` (or the project's existing dev script), open the app, and verify:
1. A "Domains" button appears in the sidebar's Views section with a count.
2. Clicking it switches to the domain view: a left rail of domains (folder-depth-grouped package names) with a depth stepper (+/−).
3. Clicking +/− changes the grouping granularity and the rail list updates.
4. Selecting a domain shows its entry points in the center pane, each with a numbered, connected preview chain.
5. Clicking a chain step populates the right-hand `DetailPanel` with that symbol (no navigation away from the domain view).
6. Clicking an entry point's header opens the existing `FlowView` rooted at that symbol.
7. A domain with zero entry points shows the "No entry points detected in this domain" empty state instead of an empty list.
8. Filtering by name/file and kind chips narrows the entry-point list as expected.

Stop the dev server once verified.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/Sidebar.svelte app/src/App.svelte
git commit -m "feat: wire DomainView into sidebar and main view router"
```

## Self-Review Notes

- **Spec coverage:** `groupPackagesByDepth` (Task 1), `previewChain` (Task 1), `domainDepth` store (Task 2), `DomainView.svelte` layout/interaction/edge cases (Task 3), Sidebar + App wiring (Task 4), pure-function tests (Task 1) — all spec sections have a corresponding task/step.
- **Placeholder scan:** none — every step has literal code.
- **Type consistency:** `groupPackagesByDepth(packages, depth)` and `previewChain(rootId, symOutAdj, maxHops)` signatures match between Task 1's implementation and Task 3's usage in `DomainView.svelte`. `domainDepth` is a plain `writable(2)`, referenced as `$domainDepth` consistently in Tasks 3 and 4.
- **Open item resolved:** the spec flagged the exact `actions.js` call site for "open FlowView rooted at this entry point" as TBD-against-real-code. Confirmed against `actions.js:84` (`openFlow(symId, dir = 'out')`) and `EntryPointsView.svelte:88` (`on:click={() => openFlow(e.symId, 'in')}` for the analogous "flow in" button) — `DomainView` uses `openFlow(e.symId, 'out')` since previewChain already walks the same downstream direction, so opening "out" keeps the entry point's header and its own chain preview visually consistent (both trace what the entry point calls, not who calls it).
