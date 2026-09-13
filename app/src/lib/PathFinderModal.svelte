<script>
  import { DATA, pathFinderOpen, symOutAdj, symInAdj } from './stores.js';
  import { shortestPath, pkgColor, displayName } from './graph.js';
  import { jumpToSymbol } from './actions.js';
  import Modal from './Modal.svelte';

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

  function reset() {
    fromQuery = '';
    toQuery = '';
    fromId = null;
    toId = null;
    path = undefined;
  }

  function close() {
    pathFinderOpen.set(false);
    reset();
  }

  function jump(symId) {
    close();
    jumpToSymbol(symId);
  }
</script>

<Modal open={$pathFinderOpen} wide title="Find path between symbols" on:close={close}>
  <div class="pf-field">
    <div class="panel-title">From symbol</div>
    <div class="pf-row">
      <input type="text" placeholder="Search a symbol…" bind:value={fromQuery} on:input={() => (fromId = null)} />
      {#if fromMatches.length > 0 && fromId === null}
        <div class="pf-suggest">
          {#each fromMatches as m (m.i)}
            <button on:click={() => pickFrom(m.i)}>{m.s[0]} <span class="muted">· {m.s[1]}</span></button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
  <div class="pf-field">
    <div class="panel-title">To symbol</div>
    <div class="pf-row">
      <input type="text" placeholder="Search a symbol…" bind:value={toQuery} on:input={() => (toId = null)} />
      {#if toMatches.length > 0 && toId === null}
        <div class="pf-suggest">
          {#each toMatches as m (m.i)}
            <button on:click={() => pickTo(m.i)}>{m.s[0]} <span class="muted">· {m.s[1]}</span></button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
  <button class="pf-find" disabled={fromId === null || toId === null} on:click={findPath}>Find path</button>

  {#if path === null}
    <div class="pf-empty">No path found between these two symbols.</div>
  {:else if path}
    <div class="panel-title" style="margin-top:14px;">Path found ({path.length} symbols)</div>
    <div class="pf-chain">
      {#each path as symId, i (symId)}
        <button class="pf-node" on:click={() => jump(symId)}>
          <span class="pf-badge">{i + 1}</span>
          <span class="pf-dot" style="background:{pkgColor(DATA.files[DATA.symbols[symId][4]][1])}"></span>
          <span class="pf-info">
            <span class="pf-name mono">{DATA.symbols[symId][0]}</span>
            <span class="pf-meta muted">{DATA.symbols[symId][1]} · {displayName(DATA.files[DATA.symbols[symId][4]][0])}</span>
          </span>
          <span class="pf-chevron">›</span>
        </button>
        {#if i < path.length - 1}<div class="pf-connector">↓</div>{/if}
      {/each}
    </div>
  {/if}
</Modal>

<style>
  .pf-field { margin-bottom: 12px; }
  .pf-row { position: relative; }
  .pf-row input {
    width: 100%;
    box-sizing: border-box;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 8px 10px;
    font-family: inherit;
    font-size: 12.5px;
    outline: none;
  }
  .pf-row input:focus { border-color: var(--accent); }
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
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
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
    width: 100%;
    box-sizing: border-box;
    background: var(--accent-soft);
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 6px;
    padding: 8px 14px;
    font-size: 12.5px;
    font-weight: 700;
    cursor: pointer;
    margin-bottom: 4px;
  }
  .pf-find:hover:not(:disabled) { background: var(--accent); color: #fff; }
  .pf-find:disabled { opacity: 0.4; cursor: default; }
  .pf-empty {
    color: var(--muted);
    font-size: 12.5px;
    text-align: center;
    padding: 18px 10px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .pf-chain { display: flex; flex-direction: column; }
  .pf-node {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    box-sizing: border-box;
    text-align: left;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 10px;
    cursor: pointer;
  }
  .pf-node:hover { border-color: var(--accent); background: var(--accent-soft); }
  .pf-badge {
    flex: 0 0 auto;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 10.5px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .pf-dot { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%; }
  .pf-info { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .pf-name {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pf-meta { font-size: 10.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pf-chevron { flex: 0 0 auto; color: var(--muted); font-size: 14px; }
  .pf-connector { text-align: center; color: var(--muted); font-size: 12px; line-height: 1.4; }
  .muted { color: var(--muted); }
</style>
