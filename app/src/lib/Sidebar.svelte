<script>
  // Left navigation panel: search, view switcher, flow/isolate controls, edge
  // kind toggles, and the package list — with collapsible, persisted sections.
  import { writable, derived } from 'svelte/store';
  import {
    DATA, view, isolate, hop, direction, showImports, showCalls, searchQuery,
    flowRoot, flowDirection, flowDepth, flowTrail, flowFeatureFilter,
    symOutAdj, symInAdj, packageFilter, symUsageInAdj,
    symbolKindFilter, detailMode, domainDepth,
  } from './stores.js';
  import {
    setIsolate, clearIsolate, openPackage, jumpToFile, jumpToSymbol,
    openFlow, openAllFlows, flowBack, setFlowDirection, setFlowFeatureFilter,
    togglePackageFocus, clearPackageFocus, toggleListView,
  } from './actions.js';
  import { pkgColor, shortPkg, displayName, featureGroup, isEntryPoint, groupPackagesByDepth } from './graph.js';

  const HOPS = [1, 2, 3, 99];
  const DIRS = [
    { key: 'both', label: 'Both' },
    { key: 'in', label: 'Callers in' },
    { key: 'out', label: 'Calls out' },
  ];
  const FLOW_DEPTHS = [1, 2, 3, 4, 6];
  const FLOW_DIRS = [
    { key: 'out', label: 'Calls →' },
    { key: 'in', label: '← Called by' },
  ];

  // Same "candidate entry point" rule EntryPointsView uses, counted here so
  // the sidebar nav button can show a count without duplicating the view.
  $: entryPointCount = (() => {
    let n = 0;
    for (let i = 0; i < DATA.symbols.length; i++) {
      const s = DATA.symbols[i];
      const inDeg = (symInAdj.get(i) || []).length;
      if (isEntryPoint(s, s[5] || '', inDeg)) n++;
    }
    return n;
  })();

  // Count of distinct domains at the current domainDepth, for the sidebar nav button.
  $: domainCount = groupPackagesByDepth(DATA.packages, $domainDepth).size;

  // Counts for the Routes / Structure nav buttons, cheap enough to compute
  // on every render (small arrays — hundreds, not thousands, of entries).
  $: routeCount = DATA.symbols.reduce((n, s) => n + (s[1] === 'route' ? 1 : 0), 0);
  $: hierarchyGroupCount = (() => {
    let n = 0;
    for (const edges of symUsageInAdj.values()) {
      if (edges.some(([, kind]) => kind === 1 || kind === 2)) n++;
    }
    return n;
  })();

  const DOCUMENTABLE_KINDS = new Set(['function', 'method', 'component', 'class', 'interface', 'type_alias']);
  $: undocumentedCount = (() => {
    let n = 0;
    for (const s of DATA.symbols) {
      if (s[3] && DOCUMENTABLE_KINDS.has(s[1]) && !s[6]) n++;
    }
    return n;
  })();

  // Pre-collect every distinct symbol-kind present in DATA so the filter
  // chips below show only kinds that actually exist in this codebase.
  $: availableKinds = (() => {
    const set = new Set();
    for (const s of DATA.symbols) set.add(s[1]);
    return [...set].sort();
  })();

  // Adds/removes a symbol kind from the active kind filter, clearing the
  // filter entirely once every kind (or none) is selected.
  function toggleKind(k) {
    symbolKindFilter.update(cur => {
      const next = new Set(cur || []);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next.size === 0 || next.size === availableKinds.length ? null : next;
    });
  }
  // Resets the symbol-kind filter so search shows every kind again.
  function clearKindFilter() { symbolKindFilter.set(null); }

  // File hits and symbol (function/class/etc) hits, interleaved with symbols
  // first — searching a function name is the more common "who calls this"
  // workflow this search box exists for.
  $: fileHits = (() => {
    const q = $searchQuery.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (let i = 0; i < DATA.files.length && out.length < 20; i++) {
      if ($packageFilter && !$packageFilter.has(DATA.files[i][1])) continue;
      if (DATA.files[i][0].toLowerCase().includes(q)) out.push(i);
    }
    return out;
  })();
  $: symbolHits = (() => {
    const q = $searchQuery.trim();
    if (!q) return [];
    const out = [];
    const kinds = $symbolKindFilter;
    const needle = q.toLowerCase();
    for (let i = 0; i < DATA.symbols.length && out.length < 20; i++) {
      const s = DATA.symbols[i];
      if ($packageFilter && !$packageFilter.has(DATA.files[s[4]][1])) continue;
      if (kinds && !kinds.has(s[1])) continue;
      if (s[0] && s[0].toLowerCase().includes(needle)) out.push(i);
    }
    return out;
  })();

  // Groups the current root's direct children (one hop, in the active
  // direction) by Features/<name> folder — the natural "which flow" label
  // for this repo's Screen/Feature composition convention. Files with no
  // Features/ segment bucket under "Other".
  $: flowGroups = (() => {
    if ($view !== 'flow' || $flowRoot === null) return [];
    const adj = $flowDirection === 'out' ? symOutAdj : symInAdj;
    const edges = adj.get($flowRoot) || [];
    const byGroup = new Map();
    for (const [id] of edges) {
      const pkgIdx = DATA.files[DATA.symbols[id][4]][1];
      if ($packageFilter && !$packageFilter.has(pkgIdx)) continue;
      const filePath = DATA.files[DATA.symbols[id][4]][0];
      const name = featureGroup(filePath) ?? 'Other';
      if (!byGroup.has(name)) byGroup.set(name, 0);
      byGroup.set(name, byGroup.get(name) + 1);
    }
    return [...byGroup.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count], i) => ({ name, count, color: pkgColor(i) }));
  })();

  // Changes the isolation hop depth and re-applies the active isolation so
  // the graph re-renders with the new radius.
  function pickHop(h) {
    hop.set(h);
    if ($isolate) setIsolate($isolate.type, $isolate.idx, $isolate.name);
  }
  // Changes the isolation direction (in/out/both) and re-applies the active
  // isolation so the graph re-renders accordingly.
  function pickDir(d) {
    direction.set(d);
    if ($isolate) setIsolate($isolate.type, $isolate.idx, $isolate.name);
  }

  // Accordion state per section. Persisted in localStorage so collapsed
  // sections stay collapsed across page reloads. The single source of
  // truth for "should this section be open by default" is DEFAULT_OPEN.
  //
  // Critical Svelte detail: `isOpen` MUST be a derived store (not a plain
  // function) so that templates using `$isOpen(...)` auto-subscribe to it.
  // A plain function calling `get(openSections)` from inside `{#if ...}`
  // does NOT register a reactive dependency — clicks update the store but
  // the template never re-evaluates. This was the root cause of the
  // "clicking does nothing" bug. As a derived store, `$isOpen` re-emits
  // a new function whenever openSections changes, and Svelte picks it up.
  const OPEN_SECTIONS_KEY = 'codegraph-sidebar-open';
  const DEFAULT_OPEN = {
    views: false,
    flowControls: true,
    flowsFromRoot: true,
    isolate: true,
    edgeKinds: true,
    packages: false,
  };
  const MIGRATE_KEYS = ['views', 'packages'];
  // Reads the persisted accordion open/closed state from localStorage,
  // dropping stale entries for keys whose default has since changed.
  function loadOpenSections() {
    if (typeof localStorage === 'undefined') return {};
    try {
      const raw = JSON.parse(localStorage.getItem(OPEN_SECTIONS_KEY) || '{}') || {};
      let migrated = false;
      for (const k of MIGRATE_KEYS) {
        if (k in raw && raw[k] !== DEFAULT_OPEN[k]) { delete raw[k]; migrated = true; }
      }
      if (migrated) {
        try { localStorage.setItem(OPEN_SECTIONS_KEY, JSON.stringify(raw)); } catch { /* ignore */ }
      }
      return raw;
    } catch { return {}; }
  }
  const openSections = writable(loadOpenSections());
  // Derived: a lookup function. `$isOpen` in the template subscribes the
  // template to changes; the function then re-evaluates with fresh state.
  const isOpen = derived(openSections, ($m) => (key) =>
    key in $m ? $m[key] : DEFAULT_OPEN[key] !== false
  );
  // Flips one accordion section's open/closed state and persists it.
  function toggleSection(key) {
    openSections.update(m => {
      const current = key in m ? m[key] : DEFAULT_OPEN[key] !== false;
      const next = { ...m, [key]: !current };
      if (typeof localStorage !== 'undefined') {
        try { localStorage.setItem(OPEN_SECTIONS_KEY, JSON.stringify(next)); } catch { /* quota */ }
      }
      return next;
    });
  }
</script>

<aside>
  <div class="panel-title-row detail-mode-row">
    <span class="section-title">Detail mode</span>
    <div class="detail-mode-toggle">
      <button type="button" class:active={$detailMode === 'overview'} on:click={() => detailMode.set('overview')}>Overview</button>
      <button type="button" class:active={$detailMode === 'deepdive'} on:click={() => detailMode.set('deepdive')}>Deep-dive</button>
    </div>
  </div>

  <div class="section section-search">
    <div class="section-head">
      <span class="section-title">Search files &amp; functions</span>
    </div>
    <div class="section-body">
      <input type="text" placeholder="e.g. AddEditOutcomeModal or formatDate" autocomplete="off" bind:value={$searchQuery} />
      <div class="kind-chips">
        {#each availableKinds as k (k)}
          <button
            class="kind-chip"
            class:active={$symbolKindFilter && $symbolKindFilter.has(k)}
            data-tip="Toggle filter: show only symbols of kind '{k}'"
            on:click={() => toggleKind(k)}
          >{k}</button>
        {/each}
        {#if $symbolKindFilter}
          <button class="kind-chip clear" on:click={clearKindFilter} data-tip="Clear kind filter" aria-label="Clear kind filter">✕</button>
        {/if}
      </div>
      <div class="search-results">
        {#each symbolHits as symId (symId)}
          <div class="search-hit-row">
            <button class="search-hit" data-tip={DATA.symbols[symId][6] || null} on:click={() => jumpToSymbol(symId)}>
              <span class="mono" style="color:var(--accent); font-weight:700;">{DATA.symbols[symId][0]}</span>
              <span style="color:var(--muted);"> · {DATA.symbols[symId][1]} · {displayName(DATA.files[DATA.symbols[symId][4]][0])}</span>
              {#if DATA.symbols[symId][6]}<div class="hit-doc">{DATA.symbols[symId][6].split('\n')[0]}</div>{/if}
            </button>
            <button class="flow-btn" data-tip="View single call flow" on:click={() => openFlow(symId, 'out')}>flow</button>
            <button class="flow-btn" data-tip="Enumerate every path through this symbol (callers + callees)" on:click={() => openAllFlows(symId)}>all</button>
          </div>
        {/each}
        {#each fileHits as i (i)}
          <button class="search-hit" style="color:{pkgColor(DATA.files[i][1])}" on:click={() => jumpToFile(i)}>
            {DATA.files[i][0]}
          </button>
        {/each}
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-head">
      <button type="button" class="section-toggle" on:click={() => toggleSection('views')} aria-expanded={$isOpen('views')}>
        <span class="section-chev" class:open={$isOpen('views')}>▸</span>
        <span class="section-title">Views</span>
      </button>
    </div>
    {#if $isOpen('views')}
      <div class="section-body">
        <button
          class="legend-item"
          class:active={$view === 'hubs'}
          data-tip="Top-N most-called functions — refactor targets"
          on:click={() => toggleListView('hubs')}
        >
          <span class="swatch" style="background:var(--accent)"></span>
          <span>Hubs</span>
          <span class="count">200</span>
        </button>
        <button
          class="legend-item"
          class:active={$view === 'entryPoints'}
          data-tip="Exported zero-callers + framework entry markers"
          on:click={() => toggleListView('entryPoints')}
        >
          <span class="swatch" style="background:#c9a13f"></span>
          <span>Entry points</span>
          <span class="count">{entryPointCount}</span>
        </button>
        <button
          class="legend-item"
          class:active={$view === 'pkgSummary'}
          data-tip="Per-package aggregate stats and top hubs"
          on:click={() => toggleListView('pkgSummary')}
        >
          <span class="swatch" style="background:#4a90d9"></span>
          <span>Pkg summary</span>
          <span class="count">{DATA.packages.length}</span>
        </button>
        <button
          class="legend-item"
          class:active={$view === 'routes'}
          data-tip="Every REST/GraphQL/WebSocket route, grouped by controller"
          on:click={() => toggleListView('routes')}
        >
          <span class="swatch" style="background:#3fa77f"></span>
          <span>API surface</span>
          <span class="count">{routeCount}</span>
        </button>
        <button
          class="legend-item"
          class:active={$view === 'structure'}
          data-tip="Class inheritance (extends/implements) and object construction (new X())"
          on:click={() => toggleListView('structure')}
        >
          <span class="swatch" style="background:#a367c9"></span>
          <span>Structure</span>
          <span class="count">{hierarchyGroupCount}</span>
        </button>
        <button
          class="legend-item"
          class:active={$view === 'docs'}
          data-tip="Docstring coverage per package, worst first"
          on:click={() => toggleListView('docs')}
        >
          <span class="swatch" style="background:#7d8590"></span>
          <span>Docs coverage</span>
          <span class="count">{undocumentedCount}</span>
        </button>
        <button
          class="legend-item"
          class:active={$view === 'domains'}
          data-tip="Business/feature domains grouped by folder depth, with entry points and call-chain previews"
          on:click={() => toggleListView('domains')}
        >
          <span class="swatch" style="background:#5b5ed6"></span>
          <span>Domains</span>
          <span class="count">{domainCount}</span>
        </button>
      </div>
    {/if}
  </div>

  {#if $view === 'flow'}
    <div class="section">
      <div class="section-head">
        <button type="button" class="section-toggle" on:click={() => toggleSection('flowControls')} aria-expanded={$isOpen('flowControls')}>
          <span class="section-chev" class:open={$isOpen('flowControls')}>▸</span>
          <span class="section-title">Flow diagram</span>
          {#if $flowTrail.length > 0}<span class="section-meta" data-tip="back steps">{$flowTrail.length}</span>{/if}
        </button>
      </div>
      {#if $isOpen('flowControls')}
        <div class="section-body">
          {#if $flowTrail.length > 0}
            <button class="pill" style="margin-bottom:10px;" on:click={flowBack}>&larr; Back</button>
          {/if}
          <div style="display:flex; flex-direction:column; gap:10px;">
            <div>
              <div class="panel-title" style="margin-bottom:6px;">Direction</div>
              <div class="seg">
                {#each FLOW_DIRS as d}
                  <button class:active={$flowDirection === d.key} on:click={() => setFlowDirection(d.key)}>{d.label}</button>
                {/each}
              </div>
            </div>
            <div>
              <div class="panel-title" style="margin-bottom:6px;">Depth</div>
              <div class="seg">
                {#each FLOW_DEPTHS as d}
                  <button class:active={$flowDepth === d} on:click={() => flowDepth.set(d)}>{d}</button>
                {/each}
              </div>
            </div>
          </div>
        </div>
      {/if}
    </div>

    {#if flowGroups.length > 1}
  <div class="section section-search">
        <div class="section-head">
          <button type="button" class="section-toggle" on:click={() => toggleSection('flowsFromRoot')} aria-expanded={$isOpen('flowsFromRoot')}>
            <span class="section-chev" class:open={$isOpen('flowsFromRoot')}>▸</span>
            <span class="section-title">Flows from this root</span>
            <span class="section-meta">{flowGroups.length}</span>
          </button>
        </div>
        {#if $isOpen('flowsFromRoot')}
          <div class="section-body">
            {#each flowGroups as g (g.name)}
              <button class="legend-item" class:selected={$flowFeatureFilter === g.name} on:click={() => setFlowFeatureFilter(g.name)}>
                <span class="swatch" style="background:{g.color}"></span>
                <span>{g.name}</span>
                <span class="count">{g.count}</span>
              </button>
            {/each}
            {#if $flowFeatureFilter}
              <button class="pill" style="margin-top:6px;" on:click={() => setFlowFeatureFilter($flowFeatureFilter)}>Show all</button>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  {:else if $view === 'packages'}
    <div class="section">
      <div class="section-head">
        <button type="button" class="section-toggle" on:click={() => toggleSection('isolate')} aria-expanded={$isOpen('isolate')}>
          <span class="section-chev" class:open={$isOpen('isolate')}>▸</span>
          <span class="section-title">Isolate dependency chain</span>
          {#if $isolate}<span class="section-meta" data-tip="active isolation">●</span>{/if}
        </button>
      </div>
      {#if $isOpen('isolate')}
        <div class="section-body">
          <div class="isolate-banner" class:active={!!$isolate}>
            <span>Isolating <b>{$isolate ? $isolate.name : '—'}</b></span>
            <button class="clear-x" data-tip="Clear isolation" aria-label="Clear isolation" on:click={clearIsolate}>✕</button>
          </div>
          <div style="display:flex; flex-direction:column; gap:10px; margin-top:8px;">
            <div>
              <div class="panel-title" style="margin-bottom:6px;">Hop depth</div>
              <div class="seg">
                {#each HOPS as h}
                  <button class:active={$hop === h} on:click={() => pickHop(h)}>{h === 99 ? 'All' : h}</button>
                {/each}
              </div>
            </div>
            <div>
              <div class="panel-title" style="margin-bottom:6px;">Direction</div>
              <div class="seg">
                {#each DIRS as d}
                  <button class:active={$direction === d.key} on:click={() => pickDir(d.key)}>{d.label}</button>
                {/each}
              </div>
            </div>
          </div>
        </div>
      {/if}
    </div>

    <div class="section">
      <div class="section-head">
        <button type="button" class="section-toggle" on:click={() => toggleSection('edgeKinds')} aria-expanded={$isOpen('edgeKinds')}>
          <span class="section-chev" class:open={$isOpen('edgeKinds')}>▸</span>
          <span class="section-title">Edge kinds</span>
        </button>
      </div>
      {#if $isOpen('edgeKinds')}
        <div class="section-body">
          <div class="toggle-row">
            <span><span class="swatch" style="background:var(--imports)"></span>&nbsp; imports</span>
            <button class="switch" class:on={$showImports} on:click={() => showImports.update(v => !v)} aria-pressed={$showImports}><span class="knob"></span></button>
          </div>
          <div class="toggle-row">
            <span><span class="swatch" style="background:var(--calls)"></span>&nbsp; calls</span>
            <button class="switch" class:on={$showCalls} on:click={() => showCalls.update(v => !v)} aria-pressed={$showCalls}><span class="knob"></span></button>
          </div>
        </div>
      {/if}
    </div>
  {/if}

  <div class="section">
    <div class="section-head">
      <button type="button" class="section-toggle" on:click={() => toggleSection('packages')} aria-expanded={$isOpen('packages')}>
        <span class="section-chev" class:open={$isOpen('packages')}>▸</span>
        <span class="section-title">Packages</span>
        {#if $packageFilter}<span class="section-meta" data-tip="active filter">●</span>{/if}
        <span class="section-meta">{$packageFilter ? `${[...$packageFilter].length}/` : ''}{DATA.packages.length}</span>
      </button>
      {#if $packageFilter}
        <button class="flow-link packages-clear" on:click={clearPackageFocus}>clear focus</button>
      {/if}
    </div>
    {#if $isOpen('packages')}
      <div class="section-body">
        {#if $packageFilter}
          <p class="focus-hint">Search &amp; flow diagram scoped to <b>{[...$packageFilter].map(i => shortPkg(DATA.packages[i][0])).join(', ')}</b>. Shift-click 📌 to add another.</p>
        {/if}
        {#each DATA.packages as p, i (i)}
          <div class="pkg-row">
            <button class="legend-item" on:click={() => openPackage(i)}>
              <span class="swatch" style="background:{pkgColor(i)}"></span>
              <span>{shortPkg(p[0])}</span>
              <span class="count">{p[1]}</span>
            </button>
            <button
              class="pin-btn"
              class:active={!!$packageFilter && $packageFilter.has(i)}
              data-tip="Focus on just this package (shift-click to add to focus)"
              on:click={(e) => togglePackageFocus(i, e.shiftKey)}
            >📌</button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</aside>

<style>
  /* Accordion sections: each one is a `.section` with a header row
     (`.section-head`) containing a clickable toggle button
     (`.section-toggle`) plus any inline controls (search mode toggle,
     "clear focus" button). The toggle is a real <button> so it can be
     focused + activated by keyboard; sibling controls stay clickable
     without toggling the section. */
  .section {
    flex: 0 0 auto;        /* keep content size — don't shrink, so when
                              total section height > aside height, the
                              aside actually overflows and scrolls
                              instead of compressing every section */
    border-top: 1px solid var(--border);
    padding-top: 8px;
    margin-top: 4px;
  }
  /* Search section: GROWS to fill empty space (flex-grow: 1) but does
     NOT shrink (flex-shrink: 0). This way:
       - When the aside has spare vertical space, the search section
         expands to fill it (so the search input is always anchored at
         the top with the results list growing below).
       - When the natural total of all sections exceeds the aside's
         available height, the search section keeps its content size
         (instead of compressing), the aside overflows, and the scrollbar
         appears so all sections remain reachable. */
  .section-search {
    flex: 1 0 auto;
    display: flex;
    flex-direction: column;
  }
  /* Inner: section-body fills the search section, search-results fills
     section-body. min-height: 0 is needed here so the search-results
     can shrink below its content size and scroll internally — the
     outer section-search no longer shrinks, but these inner pieces
     still need to. */
  .section-search .section-body {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .section-search .search-results {
    flex: 1 1 auto;
    min-height: 0;
    margin-top: 6px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .section:first-of-type {
    border-top: none;
    padding-top: 0;
    margin-top: 0;
  }
  .section-head {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
  }
  .section-toggle {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    padding: 4px 2px;
    cursor: pointer;
    color: var(--text);
    font-family: inherit;
    text-align: left;
    border-radius: 4px;
  }
  .section-toggle:hover .section-title,
  .section-toggle:focus-visible .section-title { color: var(--accent); }
  .section-toggle:hover .section-chev,
  .section-toggle:focus-visible .section-chev { color: var(--accent); }
  .section-chev {
    display: inline-block;
    color: var(--muted);
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    font-size: 10px;
    width: 10px;
    flex: 0 0 auto;
    transition: transform 0.15s ease;
  }
  .section-chev.open { transform: rotate(90deg); color: var(--accent); }
  .section-title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text);
  }
  .section-meta {
    margin-left: auto;
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    font-size: 10px;
    color: var(--muted);
  }
  .section-body {
    padding-top: 6px;
    padding-bottom: 2px;
  }
  .packages-clear { flex: 0 0 auto; font-size: 10.5px; }

  .search-hit-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .search-hit-row .search-hit { flex: 1; min-width: 0; }
  :global(.hit-doc) {
    font-size: 10.5px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 1px;
  }
  .flow-btn {
    flex: 0 0 auto;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--accent);
    background: var(--accent-soft);
    border: none;
    border-radius: 6px;
    padding: 4px 7px;
    cursor: pointer;
  }
  .flow-btn:hover { filter: brightness(1.1); }
  :global(.legend-item.selected) {
    background: var(--accent-soft);
    border-radius: 6px;
  }
  .panel-title-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 4px;
  }
  /* The detail-mode toggle sits above every other section regardless of
     `view`, so it needs the same "no top border" treatment `.section`
     gives its own first child — but it isn't a `.section` itself, which
     would otherwise make the *next* div (search) lose the first-of-type
     match. This override re-applies that reset to whichever `.section`
     immediately follows it. */
  .detail-mode-row {
    margin-bottom: 10px;
  }
  .detail-mode-row + .section {
    border-top: none;
    padding-top: 0;
    margin-top: 0;
  }
  .detail-mode-toggle {
    flex-grow: 1;
    display: flex;
    gap: 2px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 2px;
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
  .flow-link {
    font-size: 10.5px;
    font-weight: 700;
    color: var(--accent);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    white-space: nowrap;
  }
  .flow-link:hover { text-decoration: underline; }
  .focus-hint {
    font-size: 11px;
    color: var(--muted);
    line-height: 1.4;
    margin: 0 0 8px 0;
  }
  .focus-hint b { color: var(--text); }
  .pkg-row {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .pkg-row .legend-item { flex: 1; min-width: 0; }
  .pin-btn {
    flex: 0 0 auto;
    background: none;
    border: none;
    cursor: pointer;
    padding: 3px 5px;
    border-radius: 6px;
    font-size: 12px;
    opacity: 0.35;
    filter: grayscale(1);
  }
  .pin-btn:hover { opacity: 0.8; }
  .pin-btn.active { opacity: 1; filter: none; background: var(--accent-soft); }
  .kind-chips {
    display: flex; flex-wrap: wrap; gap: 4px;
    margin-top: 6px;
  }
  .kind-chip {
    background: var(--surface-2);
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 2px 8px;
    font-size: 10px;
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    cursor: pointer;
    flex-grow: 1;
  }
  .kind-chip:hover { color: var(--text); border-color: var(--accent); }
  .kind-chip.active { background: var(--accent); color: white; border-color: var(--accent); }
  .kind-chip.clear { color: var(--muted); }
</style>
