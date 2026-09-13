<script>
  import { DATA, symUsageInAdj } from './stores.js';
  import { jumpToSymbol } from './actions.js';
  import { pkgColor, displayName, classHierarchy, topInstantiated } from './graph.js';

  let tab = 'hierarchy'; // 'hierarchy' | 'constructs'
  let query = '';

  $: hierarchy = classHierarchy(DATA.symbols, symUsageInAdj);
  $: constructs = topInstantiated(DATA.symbols, symUsageInAdj);

  $: filteredHierarchy = (() => {
    const q = query.trim().toLowerCase();
    if (!q) return hierarchy;
    return hierarchy.filter(g => g.name.toLowerCase().includes(q) || g.children.some(c => c.name.toLowerCase().includes(q)));
  })();

  $: filteredConstructs = (() => {
    const q = query.trim().toLowerCase();
    if (!q) return constructs;
    return constructs.filter(g => g.name.toLowerCase().includes(q) || g.sites.some(s => s.name.toLowerCase().includes(q)));
  })();

  function pkgOf(symId) {
    return DATA.files[DATA.symbols[symId][4]][1];
  }
</script>

<div class="structure">
  <div class="head">
    <div>
      <h1>Structure</h1>
      <p class="sub">
        Two relationships the call graph can't show: class <b>inheritance</b> (extends/implements) and
        <b>construction</b> (what gets <span class="mono">new</span>'d, and from where).
      </p>
    </div>
    <input type="text" placeholder="Filter by name…" bind:value={query} />
  </div>

  <div class="tabs">
    <button class:active={tab === 'hierarchy'} on:click={() => tab = 'hierarchy'}>
      Class hierarchy <span class="tab-count">{hierarchy.length}</span>
    </button>
    <button class:active={tab === 'constructs'} on:click={() => tab = 'constructs'}>
      Constructs <span class="tab-count">{constructs.length}</span>
    </button>
  </div>

  <div class="rows">
    {#if tab === 'hierarchy'}
      {#each filteredHierarchy as g (g.symId)}
        <div class="group">
          <button class="group-head" on:click={() => jumpToSymbol(g.symId)}>
            <span class="pkg-dot" style="background:{pkgColor(pkgOf(g.symId))}"></span>
            <span class="mono name">{g.name}</span>
            <span class="kind">{g.kind}</span>
            <span class="count">{g.children.length}</span>
          </button>
          <div class="children">
            {#each g.children as c (c.symId + c.via)}
              <button class="child-row" on:click={() => jumpToSymbol(c.symId)}>
                <span class="via">{c.via}</span>
                <span class="mono child-name">{c.name}</span>
                <span class="kind">{c.kind}</span>
              </button>
            {/each}
          </div>
        </div>
      {/each}
      {#if filteredHierarchy.length === 0}
        <div class="empty">No inheritance relationships match the current filter.</div>
      {/if}
    {:else}
      {#each filteredConstructs as g (g.symId)}
        <div class="group">
          <button class="group-head" on:click={() => jumpToSymbol(g.symId)}>
            <span class="pkg-dot" style="background:{pkgColor(pkgOf(g.symId))}"></span>
            <span class="mono name">{g.name}</span>
            <span class="kind">{g.kind}</span>
            <span class="count">{g.total} site{g.total === 1 ? '' : 's'}</span>
          </button>
          <div class="children">
            {#each g.sites as s (s.symId)}
              <button class="child-row" on:click={() => jumpToSymbol(s.symId)}>
                <span class="via">new</span>
                <span class="mono child-name">{s.name}</span>
                <span class="kind">{s.kind}</span>
                {#if s.count > 1}<span class="site-count">×{s.count}</span>{/if}
              </button>
            {/each}
          </div>
        </div>
      {/each}
      {#if filteredConstructs.length === 0}
        <div class="empty">No construction sites match the current filter.</div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .structure {
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
  .head .sub b { color: var(--text); }
  .head input {
    background: var(--surface-2); border: 1px solid var(--border); color: var(--text);
    border-radius: 6px; padding: 6px 10px;
    font-family: inherit; font-size: 12.5px; width: 220px; outline: none; flex: 0 0 auto;
  }
  .head input:focus { border-color: var(--accent); }

  .tabs {
    display: flex; gap: 2px;
    padding: 8px 18px 0;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .tabs button {
    background: none; border: none; cursor: pointer;
    padding: 7px 12px;
    font-size: 12.5px; font-weight: 600; color: var(--muted);
    border-bottom: 2px solid transparent;
  }
  .tabs button.active { color: var(--accent); border-bottom-color: var(--accent); }
  .tab-count {
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    font-size: 10.5px;
    color: var(--muted);
    margin-left: 3px;
  }

  .rows { overflow-y: auto; flex: 1; padding: 10px 0 20px; }
  .group { margin: 0 18px 12px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .group-head {
    display: flex; align-items: center; gap: 8px;
    width: 100%;
    background: var(--surface-2);
    border: none;
    padding: 7px 12px;
    cursor: pointer;
    text-align: left;
  }
  .group-head:hover { background: var(--accent-soft); }
  .pkg-dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
  .name { font-size: 12.5px; font-weight: 700; color: var(--text); }
  .kind {
    color: var(--muted); font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .count {
    margin-left: auto;
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    font-size: 11px;
    color: var(--accent);
    font-weight: 700;
  }
  .children { display: flex; flex-direction: column; }
  .child-row {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 12px 6px 28px;
    background: none; border: none; border-top: 1px solid var(--border);
    text-align: left; cursor: pointer; width: 100%;
    font-size: 12px;
  }
  .child-row:hover { background: var(--accent-soft); }
  .via {
    color: var(--muted); font-size: 10px; font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    text-transform: uppercase; letter-spacing: 0.04em; width: 62px; flex: 0 0 auto;
  }
  .child-name { color: var(--text); }
  .site-count { margin-left: auto; color: var(--muted); font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); font-size: 10.5px; }
  .empty { padding: 30px; text-align: center; color: var(--muted); font-size: 13px; }
</style>
