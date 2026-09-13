<script>
  import { DATA, symInAdj, symOutAdj, symbolKindFilter, packageFilter } from './stores.js';
  import { jumpToSymbol, openFlow, openAllFlows } from './actions.js';
  import { pkgColor, displayName, complexity, transitiveReach } from './graph.js';

  const TOP_N = 200;

  let query = '';
  let kindFilter = null; // local override of the global symbolKindFilter for this view

  $: hubs = (() => {
    const all = [];
    for (let i = 0; i < DATA.symbols.length; i++) {
      const inDeg = (symInAdj.get(i) || []).length;
      if (inDeg === 0) continue;
      all.push(i);
    }
    all.sort((a, b) => (symInAdj.get(b) || []).length - (symInAdj.get(a) || []).length);
    return all.slice(0, TOP_N).map(symId => {
      const s = DATA.symbols[symId];
      const file = DATA.files[s[4]];
      const inEdges = symInAdj.get(symId) || [];
      const outEdges = symOutAdj.get(symId) || [];
      const callerPkgs = new Map();
      for (const [callerId] of inEdges) {
        const cp = DATA.files[DATA.symbols[callerId][4]][1];
        callerPkgs.set(cp, (callerPkgs.get(cp) || 0) + 1);
      }
      return {
        symId,
        name: s[0],
        kind: s[1],
        isExported: !!s[3],
        filePath: file[0],
        pkgIdx: file[1],
        pkgName: DATA.packages[file[1]] ? DATA.packages[file[1]][0].split('/').pop() : '?',
        startLine: s[2],
        inDeg: inEdges.length,
        outDeg: outEdges.length,
        reach: transitiveReach(symId, symInAdj),
        complexity: complexity(s[5]),
        callerPkgCount: callerPkgs.size,
        callerPkgDistribution: [...callerPkgs.entries()].map(([idx, count]) => ({ idx, count })),
      };
    });
  })();

  $: filtered = (() => {
    const q = query.trim().toLowerCase();
    const kinds = kindFilter !== null ? kindFilter : $symbolKindFilter;
    const pkgs = $packageFilter;
    return hubs
      .filter(h => {
        if (kinds && !kinds.has(h.kind)) return false;
        if (pkgs && !pkgs.has(h.pkgIdx)) return false;
        if (q && !h.name.toLowerCase().includes(q)) return false;
        return true;
      });
  })();

  $: maxInDeg = filtered.length > 0 ? filtered[0].inDeg : 1;

  $: availableKinds = [...new Set(DATA.symbols.map(s => s[1]))].sort();
</script>

<div class="hubs">
  <div class="head">
    <div>
      <h1>Hubs</h1>
      <p class="sub">Top {TOP_N} symbols ranked by caller count. A "hub" with hundreds of callers is the natural refactor target — every change to it ripples through the codebase. Use this to find the load-bearing functions.</p>
    </div>
    <div class="head-controls">
      <input type="text" placeholder="Filter by name…" bind:value={query} />
      <div class="kind-mini">
        {#each availableKinds as k (k)}
          <button
            class="kind-mini-btn"
            class:active={kindFilter && kindFilter.has(k)}
            on:click={() => kindFilter = kindFilter && kindFilter.has(k)
              ? (kindFilter.delete(k), kindFilter.size ? kindFilter : null)
              : new Set([k])}
          >{k}</button>
        {/each}
      </div>
    </div>
  </div>
  <div class="header-row">
    <span class="rank">#</span>
    <span class="name">name</span>
    <span class="kind-h">kind</span>
    <span class="num">callers</span>
    <span class="num">reach</span>
    <span class="num">cx</span>
    <span class="num">callees</span>
    <span class="dist">caller packages</span>
    <span class="loc">file</span>
    <span class="actions"></span>
  </div>
  <div class="rows">
    {#each filtered as h, i (h.symId)}
      <div class="row">
        <span class="rank">{i + 1}</span>
        <button class="name mono" on:click={() => jumpToSymbol(h.symId)} title={h.filePath}>{h.name}</button>
        <span class="kind-h">{h.kind}</span>
        <span class="num mono" title="in-degree (direct callers)">{h.inDeg}</span>
        <span class="num mono" title="transitive inbound reach — symbols that depend on this one through any call path">{h.reach}</span>
        <span class="num mono" class:cx-high={h.complexity > 15} class:cx-med={h.complexity > 8 && h.complexity <= 15} title="heuristic complexity">{h.complexity}</span>
        <span class="num mono" title="out-degree (callees)">{h.outDeg}</span>
        <div class="dist">
          <div class="bar" style="width: {(h.inDeg / maxInDeg * 100).toFixed(1)}%; background: var(--accent)"></div>
          {#each h.callerPkgDistribution as d (d.idx)}
            <span class="dist-pkg" style="background: {pkgColor(d.idx)}" title="pkg {DATA.packages[d.idx][0]}: {d.count}">{d.count}</span>
          {/each}
        </div>
        <span class="loc mono" title={h.filePath}>{displayName(h.filePath)}<span class="line">:{h.startLine}</span></span>
        <div class="actions">
          <button class="row-btn" title="Single flow tree" on:click={() => openFlow(h.symId, 'in')}>flow</button>
          <button class="row-btn" title="All paths (callers + callees)" on:click={() => openAllFlows(h.symId)}>all</button>
        </div>
      </div>
    {/each}
    {#if filtered.length === 0}
      <div class="empty">No hubs match the current filters.</div>
    {/if}
  </div>
</div>

<style>
  .hubs {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    font-family: var(--vscode-font-family, 'Manrope', sans-serif);
    color: var(--text);
  }
  .head {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .head h1 { margin: 0; font-size: 18px; }
  .head .sub { margin: 4px 0 0 0; color: var(--muted); font-size: 12px; line-height: 1.4; max-width: 620px; }
  .head-controls { display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
  .head input {
    background: var(--surface-2); border: 1px solid var(--border); color: var(--text);
    border-radius: 6px; padding: 6px 10px;
    font-family: inherit; font-size: 12.5px; width: 240px; outline: none;
  }
  .head input:focus { border-color: var(--accent); }
  .kind-mini { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; max-width: 360px; }
  .kind-mini-btn {
    background: var(--surface-2); color: var(--muted); border: 1px solid var(--border);
    border-radius: 12px; padding: 2px 8px; font-size: 10px;
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); cursor: pointer;
  }
  .kind-mini-btn:hover { color: var(--text); border-color: var(--accent); }
  .kind-mini-btn.active { background: var(--accent); color: white; border-color: var(--accent); }

  .header-row, .row {
    display: grid;
    grid-template-columns: 40px 1fr 100px 60px 60px 50px 60px 200px 1fr 110px;
    align-items: center;
    gap: 8px;
    padding: 6px 18px;
  }
  .header-row {
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    font-size: 10.5px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .header-row .rank, .header-row .num { text-align: right; }
  .rows { overflow-y: auto; flex: 1; }
  .row {
    border-bottom: 1px solid var(--border);
    font-size: 12.5px;
  }
  .row:hover { background: var(--accent-soft); }
  .row .rank {
    color: var(--muted); font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    font-size: 11px; text-align: right;
  }
  .row .name {
    background: none; border: none; padding: 0; cursor: pointer;
    color: var(--accent); font-weight: 700; font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    text-align: left;
  }
  .row .name:hover { text-decoration: underline; }
  .row .kind-h {
    color: var(--muted); font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .row .num { text-align: right; font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); font-size: 12px; }
  .row .num.cx-high { color: #c94f7c; font-weight: 700; }
  .row .num.cx-med { color: #c9a13f; font-weight: 700; }
  .row .dist {
    position: relative;
    height: 14px;
    display: flex; gap: 1px;
    border-radius: 3px;
    overflow: hidden;
    background: var(--surface-2);
  }
  .row .dist .bar {
    position: absolute; left: 0; top: 0; bottom: 0;
    opacity: 0.12;
  }
  .row .dist-pkg {
    flex: 1; min-width: 2px;
    color: white; font-size: 9px; font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
    position: relative; z-index: 1;
  }
  .row .loc {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--muted); font-size: 11.5px;
  }
  .row .loc .line { color: var(--accent); }
  .row .actions { display: flex; gap: 4px; justify-content: flex-end; }
  .row-btn {
    background: var(--surface-2); color: var(--muted);
    border: 1px solid var(--border); border-radius: 4px;
    padding: 2px 7px; font-size: 10px; font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    text-transform: uppercase; letter-spacing: 0.04em; cursor: pointer;
  }
  .row-btn:hover { color: var(--accent); border-color: var(--accent); }
  .empty {
    padding: 30px; text-align: center; color: var(--muted); font-size: 13px;
  }
</style>