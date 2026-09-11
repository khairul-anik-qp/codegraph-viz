<script>
  import { tick } from 'svelte';
  import {
    DATA, currentPkg, selectedFile, selectedSymbol, focusRequest, packageFilter,
  } from './stores.js';
  import { jumpToSymbol, recomputeAllFlows } from './actions.js';
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

  function setSort(key) {
    if (sortKey === key) sortDir = -sortDir;
    else { sortKey = key; sortDir = 1; }
  }

  function selectRow(idx) {
    if ($selectedFile === idx) {
      selectedFile.set(null);
      selectedSymbol.set(null);
    } else {
      selectedFile.set(idx);
      selectedSymbol.set(null);
    }
  }

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
      <button
        class="row"
        class:selected={$selectedFile === f.idx}
        data-file-idx={f.idx}
        on:click={() => selectRow(f.idx)}
      >
        <span class="path mono">{f.path}</span>
        <span class="num">{f.symCount}</span>
        <span class="num">{f.edgeCount}</span>
      </button>
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
    font-family: 'Manrope', sans-serif;
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
    font-family: 'JetBrains Mono', monospace;
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
  .row {
    background: none;
    border: none;
    border-bottom: 1px solid var(--border);
    text-align: left;
    cursor: pointer;
    font-size: 12.5px;
    color: var(--text);
    width: 100%;
  }
  .row:hover { background: var(--accent-soft); }
  .row.selected {
    background: var(--accent-soft);
    border-left: 3px solid var(--accent);
    padding-left: 11px;
  }
  .row .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row .num {
    text-align: right;
    font-family: 'JetBrains Mono', monospace;
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