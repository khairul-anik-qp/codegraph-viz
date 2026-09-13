<script>
  import { DATA, symOutAdj } from './stores.js';
  import { jumpToSymbol, openAllFlows } from './actions.js';
  import { pkgColor, displayName } from './graph.js';

  const METHOD_COLOR = {
    GET: '#4a90d9', POST: '#3fa77f', PUT: '#c9a13f', PATCH: '#c9a13f',
    DELETE: '#c94f7c', QUERY: '#4a90d9', MUTATION: '#3fa77f', WS: '#a367c9',
  };

  let query = '';
  let methodFilter = null;

  // route symbols are named "METHOD /path" by CodeGraph — split once so the
  // method becomes its own filterable/colorable column instead of free text.
  $: routes = (() => {
    const out = [];
    for (let i = 0; i < DATA.symbols.length; i++) {
      const s = DATA.symbols[i];
      if (s[1] !== 'route') continue;
      const sp = s[0].indexOf(' ');
      const method = sp === -1 ? s[0] : s[0].slice(0, sp);
      const path = sp === -1 ? '' : s[0].slice(sp + 1);
      const file = DATA.files[s[4]];
      out.push({
        symId: i, method, path, filePath: file[0], pkgIdx: file[1],
        startLine: s[2], calleeCount: (symOutAdj.get(i) || []).length,
      });
    }
    return out;
  })();

  $: methods = [...new Set(routes.map(r => r.method))].sort();

  $: byController = (() => {
    const q = query.trim().toLowerCase();
    const filtered = routes.filter(r => {
      if (methodFilter && r.method !== methodFilter) return false;
      if (q && !(r.method + ' ' + r.path).toLowerCase().includes(q)) return false;
      return true;
    });
    const groups = new Map();
    for (const r of filtered) {
      if (!groups.has(r.filePath)) groups.set(r.filePath, []);
      groups.get(r.filePath).push(r);
    }
    return [...groups.entries()]
      .map(([filePath, rs]) => ({
        filePath,
        pkgIdx: rs[0].pkgIdx,
        routes: rs.sort((a, b) => a.startLine - b.startLine),
      }))
      .sort((a, b) => b.routes.length - a.routes.length);
  })();

  $: totalShown = byController.reduce((acc, g) => acc + g.routes.length, 0);
</script>

<div class="routes">
  <div class="head">
    <div>
      <h1>API surface</h1>
      <p class="sub">Every route CodeGraph found — REST handlers, GraphQL resolvers, WebSocket gateways — grouped by controller. These are natural entry points: use "all paths" on one to see everything it touches downstream.</p>
    </div>
    <div class="head-controls">
      <input type="text" placeholder="Filter by method or path…" bind:value={query} />
      <div class="method-mini">
        {#each methods as m (m)}
          <button
            class="method-mini-btn"
            class:active={methodFilter === m}
            style={methodFilter === m ? `background:${METHOD_COLOR[m] || 'var(--accent)'};border-color:${METHOD_COLOR[m] || 'var(--accent)'}` : ''}
            on:click={() => methodFilter = methodFilter === m ? null : m}
          >{m}</button>
        {/each}
      </div>
    </div>
  </div>

  <div class="rows">
    {#each byController as g (g.filePath)}
      <div class="controller-group">
        <div class="controller-head">
          <span class="pkg-dot" style="background:{pkgColor(g.pkgIdx)}"></span>
          <span class="mono controller-name" title={g.filePath}>{displayName(g.filePath)}</span>
          <span class="controller-count">{g.routes.length}</span>
        </div>
        {#each g.routes as r (r.symId)}
          <button class="route-row" on:click={() => jumpToSymbol(r.symId)}>
            <span class="method mono" style="color:{METHOD_COLOR[r.method] || 'var(--accent)'}">{r.method}</span>
            <span class="path mono">{r.path}</span>
            <span class="line mono">:{r.startLine}</span>
            <span class="callees" title="downstream calls from this handler">{r.calleeCount} calls out</span>
            <span
              class="row-btn"
              role="button"
              tabindex="0"
              on:click|stopPropagation={() => openAllFlows(r.symId)}
              on:keydown|stopPropagation={(e) => { if (e.key === 'Enter') openAllFlows(r.symId); }}
              title="Enumerate every path through this handler"
            >all →</span>
          </button>
        {/each}
      </div>
    {/each}
    {#if totalShown === 0}
      <div class="empty">No routes match the current filters.</div>
    {/if}
  </div>
</div>

<style>
  .routes {
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
  .method-mini { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; max-width: 320px; }
  .method-mini-btn {
    background: var(--surface-2); color: var(--muted); border: 1px solid var(--border);
    border-radius: 12px; padding: 2px 8px; font-size: 10px;
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); font-weight: 700; cursor: pointer;
  }
  .method-mini-btn:hover { color: var(--text); }
  .method-mini-btn.active { color: white; }

  .rows { overflow-y: auto; flex: 1; padding-bottom: 12px; }
  .controller-group { border-bottom: 1px solid var(--border); }
  .controller-head {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 18px;
    background: var(--surface-2);
    position: sticky; top: 0;
  }
  .pkg-dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
  .controller-name { font-size: 12px; font-weight: 700; }
  .controller-count {
    margin-left: auto;
    color: var(--muted);
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    font-size: 11px;
  }
  .route-row {
    display: grid;
    grid-template-columns: 64px 1fr 50px 110px 50px;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px 18px;
    background: none;
    border: none;
    border-top: 1px solid var(--border);
    text-align: left;
    cursor: pointer;
    font-size: 12.5px;
    color: var(--text);
  }
  .route-row:hover { background: var(--accent-soft); }
  .route-row .method { font-weight: 700; font-size: 11px; }
  .route-row .path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .route-row .line { color: var(--muted); font-size: 11px; }
  .route-row .callees { color: var(--muted); font-size: 10.5px; text-align: right; white-space: nowrap; }
  .route-row .row-btn {
    color: var(--accent);
    font-size: 10.5px; font-weight: 700;
    text-align: right;
    cursor: pointer;
  }
  .route-row .row-btn:hover { text-decoration: underline; }
  .empty { padding: 30px; text-align: center; color: var(--muted); font-size: 13px; }
</style>
