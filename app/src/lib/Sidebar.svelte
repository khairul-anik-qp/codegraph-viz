<script>
  // Left navigation panel: search, view switcher, flow/isolate controls, edge
  // kind toggles, and the package list.
  import {
    DATA, view, isolate, hop, direction, showImports, showCalls,
    flowRoot, flowDirection, flowDepth, flowTrail, flowFeatureFilter,
    symOutAdj, symInAdj, packageFilter, symUsageInAdj,
    detailMode, domainDepth, pinnedViews, sidebarOpen,
  } from './stores.js';
  import {
    setIsolate, clearIsolate, openPackage,
    flowBack, setFlowDirection, setFlowFeatureFilter,
    togglePackageFocus, clearPackageFocus, toggleListView, togglePinnedView,
  } from './actions.js';
  import { pkgColor, shortPkg, featureGroup, isEntryPoint, groupPackagesByDepth } from './graph.js';

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


  // Every standalone view reachable from this nav, in one place — each
  // rendered identically whether it's pinned (always-visible "Primary"
  // strip) or not (collapsible "More views" catalog below it). 'packages'
  // isn't listed: it's the permanent home view, already one click away via
  // the header's "Packages" breadcrumb, so it doesn't need a nav slot too.
  $: viewCatalog = [
    { key: 'flow', label: 'Flow', tip: 'Single-symbol call flow — search a function in the flow screen or click any graph node, then trace what it calls', count: null },
    { key: 'routes', label: 'API surface', tip: 'Every REST/GraphQL/WebSocket route, grouped by controller', count: routeCount },
    { key: 'domains', label: 'Domains', tip: 'Business/feature domains grouped by folder depth, with entry points and call-chain previews', count: domainCount },
    { key: 'hubs', label: 'Hubs', tip: 'Top-N most-called functions — refactor targets', count: 200 },
    { key: 'entryPoints', label: 'Entry points', tip: 'Exported zero-callers + framework entry markers', count: entryPointCount },
    { key: 'structure', label: 'Structure', tip: 'Class inheritance (extends/implements) and object construction (new X())', count: hierarchyGroupCount },
    { key: 'pkgSummary', label: 'Pkg summary', tip: 'Per-package aggregate stats: size, docs coverage, deps, dead code, top hubs, complexity hotspots', count: DATA.packages.length },
    { key: 'docs', label: 'Docs coverage', tip: 'Docstring coverage per package, worst first', count: undocumentedCount },
    { key: 'indexHealth', label: 'Index health', tip: 'Whether this export can be trusted right now — stale files, unresolved imports', count: null },
  ];
  $: pinnedCatalog = viewCatalog.filter(v => $pinnedViews.includes(v.key));
  $: unpinnedCatalog = viewCatalog.filter(v => !$pinnedViews.includes(v.key));

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

</script>

<aside class:collapsed={!$sidebarOpen}>
  <button
    type="button"
    class="sidebar-toggle"
    data-tip={$sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
    aria-label={$sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
    on:click={() => sidebarOpen.update(v => !v)}
  >{$sidebarOpen ? '⟨' : '⟩'}</button>

  {#if $sidebarOpen}
  <div class="panel-title-row detail-mode-row">
    <span class="section-title">Detail mode</span>
    <div class="detail-mode-toggle">
      <button type="button" class:active={$detailMode === 'overview'} on:click={() => detailMode.set('overview')}>Overview</button>
      <button type="button" class:active={$detailMode === 'deepdive'} on:click={() => detailMode.set('deepdive')}>Deep-dive</button>
    </div>
  </div>

  {#if pinnedCatalog.length}
    <div class="section">
      <div class="section-head">
        <span class="section-title">Primary</span>
      </div>
      <div class="section-body">
        {#each pinnedCatalog as v (v.key)}
          <div class="view-row">
            <button class="legend-item" class:active={$view === v.key} data-tip={v.tip} on:click={() => toggleListView(v.key)}>
              <span>{v.label}</span>
              {#if v.count != null}<span class="count">{v.count}</span>{/if}
            </button>
            <button class="pin-btn active" data-tip="Unpin from Primary" aria-label="Unpin {v.label}" on:click={() => togglePinnedView(v.key)}>★</button>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <div class="section">
    <div class="section-head">
      <span class="section-title">More views</span>
    </div>
    <div class="section-body">
      {#each unpinnedCatalog as v (v.key)}
        <div class="view-row">
          <button class="legend-item" class:active={$view === v.key} data-tip={v.tip} on:click={() => toggleListView(v.key)}>
            <span>{v.label}</span>
            {#if v.count != null}<span class="count">{v.count}</span>{/if}
          </button>
          <button class="pin-btn" data-tip="Pin to Primary" aria-label="Pin {v.label}" on:click={() => togglePinnedView(v.key)}>☆</button>
        </div>
      {/each}
    </div>
  </div>

  {#if $view === 'flow'}
    <div class="section">
      <div class="section-head">
        <span class="section-title">Flow diagram</span>
        {#if $flowTrail.length > 0}<span class="section-meta" data-tip="back steps">{$flowTrail.length}</span>{/if}
      </div>
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
    </div>

    {#if flowGroups.length > 1}
  <div class="section section-search">
        <div class="section-head">
          <span class="section-title">Flows from this root</span>
          <span class="section-meta">{flowGroups.length}</span>
        </div>
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
      </div>
    {/if}
  {:else if $view === 'packages'}
    <div class="section">
      <div class="section-head">
        <span class="section-title">Isolate dependency chain</span>
        {#if $isolate}<span class="section-meta" data-tip="active isolation">●</span>{/if}
      </div>
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
    </div>

    <div class="section">
      <div class="section-head">
        <span class="section-title">Edge kinds</span>
      </div>
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
    </div>
  {/if}

  <div class="section">
    <div class="section-head">
      <span class="section-title">Packages</span>
      {#if $packageFilter}<span class="section-meta" data-tip="active filter">●</span>{/if}
      <span class="section-meta">{$packageFilter ? `${[...$packageFilter].length}/` : ''}{DATA.packages.length}</span>
      {#if $packageFilter}
        <button class="flow-link packages-clear" on:click={clearPackageFocus}>clear focus</button>
      {/if}
    </div>
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
  </div>
  {/if}
</aside>

<style>
  aside {
    position: relative;
    transition: width 0.15s ease, padding 0.15s ease;
  }
  aside.collapsed {
    width: 34px;
    min-width: 34px;
    padding: 16px 6px;
    align-items: center;
    overflow: hidden;
  }
  .sidebar-toggle {
    flex: 0 0 auto;
    align-self: flex-end;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--muted);
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
    margin-bottom: 10px;
  }
  aside.collapsed .sidebar-toggle { align-self: center; margin-bottom: 0; }
  .sidebar-toggle:hover { color: var(--accent); border-color: var(--accent); }

  /* Sections: each one is a `.section` with a header row (`.section-head`)
     holding the title plus any inline controls ("clear focus" button). */
  .section {
    flex: 0 0 auto;        /* keep content size — don't shrink, so when
                              total section height > aside height, the
                              aside actually overflows and scrolls
                              instead of compressing every section */
    border-top: 1px solid var(--border);
    padding-top: 8px;
    margin-top: 4px;
  }
  /* .section-search: GROWS to fill empty space (flex-grow: 1) but does
     NOT shrink (flex-shrink: 0), so when the natural total of all sections
     exceeds the aside's available height, this section keeps its content
     size (instead of compressing) and the aside scrolls instead. */
  .section-search {
    flex: 1 0 auto;
    display: flex;
    flex-direction: column;
  }
  .section-search .section-body {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
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
  .pkg-row, .view-row {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .pkg-row .legend-item, .view-row .legend-item { flex: 1; min-width: 0; }
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
  .pin-btn.active { opacity: 1; filter: none; }
</style>
