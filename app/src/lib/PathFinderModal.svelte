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
