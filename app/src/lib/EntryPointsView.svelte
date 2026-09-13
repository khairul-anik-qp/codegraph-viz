<script>
  import { DATA, symInAdj, symbolKindFilter, packageFilter } from './stores.js';
  import { jumpToSymbol, openFlow, openAllFlows } from './actions.js';
  import { pkgColor, displayName, isEntryPoint, complexity } from './graph.js';

  let query = '';
  let kindOverride = null; // local override

  $: entryPoints = (() => {
    const out = [];
    for (let i = 0; i < DATA.symbols.length; i++) {
      const s = DATA.symbols[i];
      const inDeg = (symInAdj.get(i) || []).length;
      if (!isEntryPoint(s, s[5] || '', inDeg)) continue;
      const f = DATA.files[s[4]];
      out.push({
        symId: i,
        name: s[0],
        kind: s[1],
        isExported: !!s[3],
        filePath: f[0],
        pkgIdx: f[1],
        pkgName: DATA.packages[f[1]] ? DATA.packages[f[1]][0].split('/').pop() : '?',
        startLine: s[2],
        inDeg,
        reason: s[3] && inDeg === 0 ? 'exported · no internal callers' : 'framework entry marker',
        snippetLine: (s[5] || '').split('\n').find(l => l.trim()) || '',
        complexity: complexity(s[5]),
      });
    }
    out.sort((a, b) => a.pkgName.localeCompare(b.pkgName) || a.name.localeCompare(b.name));
    return out;
  })();

  $: filtered = (() => {
    const q = query.trim().toLowerCase();
    const kinds = kindOverride !== null ? kindOverride : $symbolKindFilter;
    const pkgs = $packageFilter;
    return entryPoints.filter(e => {
      if (kinds && !kinds.has(e.kind)) return false;
      if (pkgs && !pkgs.has(e.pkgIdx)) return false;
      if (q && !e.name.toLowerCase().includes(q) && !e.filePath.toLowerCase().includes(q)) return false;
      return true;
    });
  })();

  $: availableKinds = [...new Set(entryPoints.map(e => e.kind))].sort();
</script>

<div class="entry-points">
  <div class="head">
    <div>
      <h1>Entry points</h1>
      <p class="sub">{entryPoints.length} candidate entry points — exported symbols with no internal callers, plus anything matching a framework entry marker (HTTP route decorator, lifecycle hook, CLI handler, <code>def main</code>). These are the lines outside code calls reach into the program through.</p>
    </div>
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
  </div>
  <div class="rows">
    {#each filtered as e (e.symId)}
      <div class="row">
        <div class="row-main">
          <button class="name mono" on:click={() => jumpToSymbol(e.symId)} title={e.filePath}>{e.name}</button>
          <span class="kind">{e.kind}</span>
          <span class="reason" title={e.reason}>{e.reason}</span>
          {#if e.isExported}<span class="badge exp">exported</span>{/if}
          {#if e.complexity > 8}<span class="badge cx" title="Complexity {e.complexity}">cx {e.complexity}</span>{/if}
        </div>
        <div class="row-meta">
          <span class="pkg" style="color:{pkgColor(e.pkgIdx)}">{e.pkgName}</span>
          <span class="file mono">{displayName(e.filePath)}<span class="line">:{e.startLine}</span></span>
        </div>
        <div class="row-snippet mono">{e.snippetLine.slice(0, 100)}</div>
        <div class="row-actions">
          <button class="row-btn" on:click={() => openFlow(e.symId, 'in')}>flow in</button>
          <button class="row-btn" on:click={() => openAllFlows(e.symId)}>all</button>
        </div>
      </div>
    {/each}
    {#if filtered.length === 0}
      <div class="empty">No entry points match the current filters.</div>
    {/if}
  </div>
</div>

<style>
  .entry-points {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    font-family: var(--vscode-font-family, 'Manrope', sans-serif);
    color: var(--text);
  }
  .head {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
    padding: 14px 18px; border-bottom: 1px solid var(--border); background: var(--surface);
  }
  .head h1 { margin: 0; font-size: 18px; }
  .head .sub { margin: 4px 0 0 0; color: var(--muted); font-size: 12px; line-height: 1.4; max-width: 640px; }
  .head .sub code { background: var(--surface-2); padding: 1px 5px; border-radius: 3px; font-size: 11px; }
  .head-controls { display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
  .head input {
    background: var(--surface-2); border: 1px solid var(--border); color: var(--text);
    border-radius: 6px; padding: 6px 10px;
    font-family: inherit; font-size: 12.5px; width: 240px; outline: none;
  }
  .head input:focus { border-color: var(--accent); }
  .kind-mini { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
  .kind-mini-btn {
    background: var(--surface-2); color: var(--muted); border: 1px solid var(--border);
    border-radius: 12px; padding: 2px 8px; font-size: 10px;
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); cursor: pointer;
  }
  .kind-mini-btn:hover { color: var(--text); border-color: var(--accent); }
  .kind-mini-btn.active { background: var(--accent); color: white; border-color: var(--accent); }
  .rows { overflow-y: auto; flex: 1; padding: 8px 18px 18px; display: flex; flex-direction: column; gap: 6px; }
  .row {
    background: var(--surface);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: 6px;
    padding: 8px 12px;
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto auto;
    gap: 4px 12px;
  }
  .row-main { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .row-main .name { background: none; border: none; padding: 0; cursor: pointer; color: var(--accent); font-weight: 700; font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); font-size: 13px; }
  .row-main .name:hover { text-decoration: underline; }
  .row-main .kind { color: var(--muted); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); }
  .row-main .reason { color: var(--muted); font-size: 11px; font-style: italic; }
  .row-main .badge { font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); font-size: 9.5px; padding: 1px 6px; border-radius: 8px; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 700; }
  .row-main .badge.exp { background: rgba(63, 167, 127, 0.18); color: #3fa77f; }
  .row-main .badge.cx { background: rgba(201, 79, 124, 0.18); color: #c94f7c; }
  .row-meta { display: flex; gap: 12px; align-items: baseline; grid-column: 1; font-size: 11px; color: var(--muted); }
  .row-meta .pkg { font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); font-size: 11.5px; font-weight: 700; }
  .row-meta .file { font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); }
  .row-meta .file .line { color: var(--accent); }
  .row-actions { display: flex; gap: 4px; grid-row: 1 / span 2; grid-column: 2; align-self: center; }
  .row-btn {
    background: var(--surface-2); color: var(--muted); border: 1px solid var(--border);
    border-radius: 4px; padding: 3px 8px; font-size: 10px;
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); text-transform: uppercase;
    letter-spacing: 0.04em; cursor: pointer;
  }
  .row-btn:hover { color: var(--accent); border-color: var(--accent); }
  .row-snippet {
    grid-column: 1 / -1;
    font-size: 10.5px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty {
    padding: 30px; text-align: center; color: var(--muted); font-size: 13px;
  }
</style>