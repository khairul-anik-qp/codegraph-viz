<script>
  // Sortable, filterable list of files within a package. Clicking a file row
  // opens the flow view rooted at that file's most-connected callable symbol
  // (its "dominant" flow); the ⓘ button inspects the file in the detail
  // panel instead. Rows also scroll-into-view for search-hit focus.
  import { tick } from 'svelte';
  import {
    DATA, currentPkg, selectedFile, selectedSymbol, focusRequest, packageFilter,
    symInAdj, symOutAdj,
  } from './stores.js';
  import { jumpToSymbol, recomputeAllFlows, openFlow } from './actions.js';
  import { displayName } from './graph.js';

  export let pkgIdx;

  let sortKey = 'path'; // 'path' | 'symbols' | 'edges'
  let sortDir = 1; // 1 asc, -1 desc
  let query = '';
  let listEl;
  let lastFocusedFile = null;

  $: pkgFiles = (() => {
    const out = [];
    for (let i = 0; i < DATA.files.length; i++) {
      if (DATA.files[i][1] !== pkgIdx) continue;
      if ($packageFilter && $packageFilter.size > 0 && !$packageFilter.has(DATA.files[i][1])) continue;
      const symCount = (DATA.fileSymbolIds[i] || []).length;
      const edgeCount = DATA.fileEdges.reduce((n, e) => n += (e[0] === i || e[1] === i) ? 1 : 0, 0);
      out.push({ idx: i, path: DATA.files[i][0], lang: DATA.files[i][2], symCount, edgeCount });
    }
    return out;
  })();

  $: filteredFiles = (() => {
    const q = query.trim().toLowerCase();
    const arr = q ? pkgFiles.filter(f => f.path.toLowerCase().includes(q)) : pkgFiles;
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av < bv) return -1 * sortDir;
      if (av > bv) return 1 * sortDir;
      return 0;
    });
    return arr;
  })();

  // Toggles sort column, flipping direction if the same column is clicked again.
  function setSort(key) {
    if (sortKey === key) sortDir = -sortDir;
    else { sortKey = key; sortDir = 1; }
  }

  // Selects a file row (ⓘ button), or deselects it if it's already selected.
  function selectRow(idx) {
    if ($selectedFile === idx) {
      selectedFile.set(null);
      selectedSymbol.set(null);
    } else {
      selectedFile.set(idx);
      selectedSymbol.set(null);
    }
  }

  // The file's most-connected callable symbol — the natural root when the
  // user asks "show me this file's flow". Ties go to the first symbol in
  // source order (lowest id, since fileSymbolIds is line-ordered).
  const CALLABLE_KINDS = new Set(['function', 'method', 'component', 'class', 'route']);
  function hubSymId(fileIdx) {
    let best = null;
    let bestDeg = -1;
    for (const id of (DATA.fileSymbolIds[fileIdx] || [])) {
      if (!CALLABLE_KINDS.has(DATA.symbols[id][1])) continue;
      const deg = (symInAdj.get(id) || []).length + (symOutAdj.get(id) || []).length;
      if (deg > bestDeg) { bestDeg = deg; best = id; }
    }
    return best;
  }
  // Row click: open the flow view rooted at the file's hub symbol. Files
  // with nothing callable (pure type/constant modules) fall back to the
  // old select-for-inspection behavior.
  function openFileFlow(fileIdx) {
    const hub = hubSymId(fileIdx);
    if (hub !== null) openFlow(hub, 'out');
    else selectRow(fileIdx);
  }

  // Returns the display-friendly path for a file index.
  function rowFile(fileIdx) {
    const f = DATA.files[fileIdx];
    return displayName(f[0]);
  }

  // Scroll the focused file into view when something asks us to focus it
  // (e.g. a search hit). focusRequest is cleared once consumed.
  $: if ($focusRequest && $focusRequest.fileIdx !== lastFocusedFile && listEl) {
    lastFocusedFile = $focusRequest.fileIdx;
    tick().then(() => {
      const row = listEl.querySelector(`[data-file-idx="${$focusRequest.fileIdx}"]`);
      if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      focusRequest.set(null);
    });
  }
</script>

<div class="file-list">
  <div class="toolbar">
    <input type="text" placeholder="Filter files in this package…" bind:value={query} />
    <span class="count">{filteredFiles.length} / {pkgFiles.length}</span>
  </div>
  <div class="header-row">
    <button class="col-h" class:active={sortKey === 'path'} on:click={() => setSort('path')}>
      path {sortKey === 'path' ? (sortDir === 1 ? '↑' : '↓') : ''}
    </button>
    <button class="col-h num" class:active={sortKey === 'symbols'} on:click={() => setSort('symbols')}>
      symbols {sortKey === 'symbols' ? (sortDir === 1 ? '↑' : '↓') : ''}
    </button>
    <button class="col-h num" class:active={sortKey === 'edges'} on:click={() => setSort('edges')}>
      edges {sortKey === 'edges' ? (sortDir === 1 ? '↑' : '↓') : ''}
    </button>
  </div>
  <div class="rows" bind:this={listEl}>
    {#each filteredFiles as f (f.idx)}
      <div class="row-wrap" class:selected={$selectedFile === f.idx} data-file-idx={f.idx}>
        <button
          class="row"
          data-tip="Open this file's dominant call flow"
          on:click={() => openFileFlow(f.idx)}
        >
          <span class="path mono">{f.path}</span>
          <span class="num">{f.symCount}</span>
          <span class="num">{f.edgeCount}</span>
        </button>
        <button
          class="inspect"
          data-tip="Inspect this file in the detail panel"
          aria-label="Inspect file {f.path}"
          on:click={() => selectRow(f.idx)}
        >ⓘ</button>
      </div>
    {/each}
    {#if filteredFiles.length === 0}
      <div class="empty">No files match.</div>
    {/if}
  </div>
</div>

<style>
  .file-list {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    font-family: var(--vscode-font-family, 'Manrope', sans-serif);
    color: var(--text);
  }
  .toolbar {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .toolbar input {
    flex: 1;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 6px 10px;
    font-family: inherit;
    font-size: 12.5px;
    outline: none;
  }
  .toolbar input:focus { border-color: var(--accent); }
  .toolbar .count {
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    font-size: 11px;
    color: var(--muted);
  }

  .header-row, .row {
    display: grid;
    grid-template-columns: 1fr 70px 70px;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
  }
  .header-row {
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    font-size: 10.5px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .col-h {
    background: none; border: none; padding: 0; cursor: pointer;
    color: var(--muted); font: inherit; text-transform: inherit; letter-spacing: inherit;
    text-align: left;
  }
  .col-h.active { color: var(--accent); font-weight: 700; }
  .col-h.num { text-align: right; }

  .rows { overflow-y: auto; flex: 1; }
  .row-wrap {
    display: grid;
    grid-template-columns: 1fr 34px;
    align-items: stretch;
    border-bottom: 1px solid var(--border);
  }
  .row-wrap.selected {
    background: var(--accent-soft);
    border-left: 3px solid var(--accent);
  }
  .row-wrap.selected .row { padding-left: 11px; }
  .row {
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    font-size: 12.5px;
    color: var(--text);
  }
  .row:hover { background: var(--accent-soft); }
  .inspect {
    background: none;
    border: none;
    color: var(--muted);
    font-size: 12px;
    cursor: pointer;
    padding: 0;
  }
  .inspect:hover { color: var(--accent); }
  .row .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row .num {
    text-align: right;
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    font-size: 11px;
    color: var(--muted);
  }
  .empty {
    padding: 30px;
    text-align: center;
    color: var(--muted);
    font-size: 13px;
  }
</style>