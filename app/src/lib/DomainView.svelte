<script>
  // Groups packages into coarse business/feature "domains" by folder-depth
  // truncation, lists each domain's detected entry points, and previews a
  // short linear call chain per entry point. Purely structural — no LLM, no
  // new export-time data. See docs/superpowers/specs/2026-09-13-domain-view-design.md.
  import { DATA, symOutAdj, symInAdj, domainDepth, symbolKindFilter } from './stores.js';
  import { selectSymbol, openFlow } from './actions.js';
  import { groupPackagesByDepth, previewChain, isEntryPoint, pkgColor, displayName, parseDocTags } from './graph.js';

  const MAX_HOPS = 4;

  let selectedDomain = null; // domain name string, or null
  let query = '';
  let kindOverride = null; // local kind-chip filter, same pattern as EntryPointsView

  // Deepest folder-depth any package name actually has — increasing
  // domainDepth past this can never change the grouping, so the depth
  // stepper's '+' button disables here instead of clicking into no-op territory.
  $: maxRealDepth = DATA.packages.reduce((m, [name]) => Math.max(m, name.split('/').length), 1);

  $: structuralDomains = [...groupPackagesByDepth(DATA.packages, $domainDepth).entries()]
    .map(([name, pkgIdxs]) => ({ name, tagged: false, pkgIdxs, pkgCount: pkgIdxs.length }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Entry points that declare an @domain tag are grouped by that tag instead
  // of folder depth — see parseDocTags in graph.js. Everything else keeps
  // falling into the folder-depth groups above, so tagging is opt-in.
  $: taggedDomains = (() => {
    const groups = new Map();
    for (const e of allEntryPoints) {
      if (!e.tagDomain) continue;
      if (!groups.has(e.tagDomain)) groups.set(e.tagDomain, { name: e.tagDomain, tagged: true, pkgIdxs: new Set(), entryCount: 0 });
      const g = groups.get(e.tagDomain);
      g.pkgIdxs.add(e.pkgIdx);
      g.entryCount++;
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  })();

  $: domains = [...taggedDomains, ...structuralDomains];

  // Keep a valid selection across depth changes: fall back to the first
  // domain if the previously selected one no longer exists, or pick the
  // first domain on initial load.
  $: if (domains.length && !domains.some((d) => d.name === selectedDomain)) {
    selectedDomain = domains[0].name;
  }

  $: currentDomain = domains.find((d) => d.name === selectedDomain) || null;

  // Entry-point detection is domain-independent (isEntryPoint only looks at
  // the symbol itself), so it's computed once here rather than rescanning
  // every symbol on each rail click; per-domain filtering below is just a
  // pkgIdx-set membership check over this list.
  $: allEntryPoints = (() => {
    const out = [];
    for (let i = 0; i < DATA.symbols.length; i++) {
      const s = DATA.symbols[i];
      const f = DATA.files[s[4]];
      const inDeg = (symInAdj.get(i) || []).length;
      if (!isEntryPoint(s, s[5] || '', inDeg)) continue;
      const { domain: tagDomain, flow: tagFlow, clean: doc } = parseDocTags(s[6] || '');
      out.push({
        symId: i,
        name: s[0],
        kind: s[1],
        filePath: f[0],
        pkgIdx: f[1],
        startLine: s[2],
        doc,
        tagDomain,
        tagFlow,
        chain: previewChain(i, symOutAdj, MAX_HOPS),
      });
    }
    return out;
  })();

  $: entryPoints = currentDomain
    ? (() => {
        if (currentDomain.tagged) {
          return allEntryPoints.filter((e) => e.tagDomain === currentDomain.name).sort((a, b) => a.name.localeCompare(b.name));
        }
        // Structural (folder-depth) domains only show entries that aren't
        // already claimed by a tagged domain above, so a tagged entry point
        // doesn't get listed twice.
        const pkgSet = new Set(currentDomain.pkgIdxs);
        return allEntryPoints.filter((e) => !e.tagDomain && pkgSet.has(e.pkgIdx)).sort((a, b) => a.name.localeCompare(b.name));
      })()
    : [];

  $: filtered = (() => {
    const q = query.trim().toLowerCase();
    const kinds = kindOverride !== null ? kindOverride : $symbolKindFilter;
    return entryPoints.filter((e) => {
      if (kinds && !kinds.has(e.kind)) return false;
      if (q && !e.name.toLowerCase().includes(q) && !e.filePath.toLowerCase().includes(q)) return false;
      return true;
    });
  })();

  $: availableKinds = [...new Set(entryPoints.map((e) => e.kind))].sort();

  // Clears the local entry-point filters. Called whenever the effective
  // domain is about to change — either directly (clicking a different rail
  // item) or indirectly (a depth change can shift which domain is
  // "current" via the selectedDomain fallback above) — so stale filters
  // from the previous domain never mask an entirely different domain's
  // entry points.
  function resetFilters() {
    query = '';
    kindOverride = null;
  }

  function selectDomain(name) {
    selectedDomain = name;
    resetFilters();
  }

  function stepDepth(delta) {
    domainDepth.update((d) => Math.max(1, d + delta));
    resetFilters();
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
        <button class="step-btn" on:click={() => stepDepth(1)} disabled={$domainDepth >= maxRealDepth}>+</button>
      </div>
    </div>
    <div class="rail-list">
      {#if taggedDomains.length}
        <div class="rail-group-label">@domain tagged</div>
        {#each taggedDomains as d (d.name)}
          <button class="rail-item" class:active={selectedDomain === d.name} on:click={() => selectDomain(d.name)}>
            <span class="rail-name mono">{d.name}</span>
            <span class="rail-count">{d.entryCount} entry{d.entryCount === 1 ? '' : ' pts'}</span>
          </button>
        {/each}
        <div class="rail-group-label">By folder depth</div>
      {/if}
      {#each structuralDomains as d (d.name)}
        <button class="rail-item" class:active={selectedDomain === d.name} on:click={() => selectDomain(d.name)}>
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
              {#if e.doc}<p class="entry-doc">{e.doc}</p>{/if}
              {#if e.tagDomain || e.tagFlow}
                <div class="tag-row">
                  {#if e.tagDomain}<span class="tagchip">@domain {e.tagDomain}</span>{/if}
                  {#if e.tagFlow}<span class="tagchip flow">@flow {e.tagFlow}</span>{/if}
                </div>
              {/if}
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
  .rail-group-label {
    font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--muted); padding: 8px 6px 2px;
  }
  .rail-group-label:first-child { padding-top: 2px; }
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
  .entry-doc { margin: 0 0 8px 0; font-size: 11.5px; color: var(--muted); line-height: 1.4; }
  .tag-row { display: flex; flex-wrap: wrap; gap: 6px; margin: -2px 0 8px; }
  .tagchip {
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); font-size: 10px; font-weight: 700;
    padding: 2px 7px; border-radius: 10px; background: var(--accent-soft); color: var(--accent);
  }
  .tagchip.flow { background: color-mix(in srgb, #3fa77f 20%, var(--surface)); color: #3fa77f; }

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
