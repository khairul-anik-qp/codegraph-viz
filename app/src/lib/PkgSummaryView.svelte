<script>
  import { DATA, packageFilter, symInAdj } from './stores.js';
  import { jumpToFile, jumpToSymbol } from './actions.js';
  import { pkgColor, displayName, packageSummaries } from './graph.js';

  let query = '';

  $: summaries = packageSummaries(DATA.packages, DATA.files, DATA.symbols, symInAdj, DATA.fileSymbolIds);

  $: filtered = (() => {
    const q = query.trim().toLowerCase();
    const pkgs = $packageFilter;
    return summaries.filter(s => {
      if (pkgs && !pkgs.has(s.pkgIdx)) return false;
      if (q && !s.name.toLowerCase().includes(q)) return false;
      return true;
    });
  })();
</script>

<div class="pkg-summary">
  <div class="head">
    <div>
      <h1>Package summary</h1>
      <p class="sub">Aggregate stats per package — files, symbols, dominant languages, top hubs by transitive reach, average complexity. Sort or click a hub to jump to the symbol.</p>
    </div>
    <input type="text" placeholder="Filter by package name…" bind:value={query} />
  </div>
  <div class="grid">
    {#each filtered as s (s.pkgIdx)}
      <div class="card">
        <div class="card-head" style="border-left-color:{pkgColor(s.pkgIdx)}">
          <span class="pkg-name mono" style="color:{pkgColor(s.pkgIdx)}">{s.name}</span>
        </div>
        <div class="kv">
          <div class="k">Files</div><div class="v"><b>{s.fileCount}</b></div>
          <div class="k">Symbols</div><div class="v"><b>{s.symbolCount}</b></div>
          <div class="k">Avg complexity</div>
          <div class="v">
            <b>{s.avgComplexity.toFixed(1)}</b>
            <span style="color:var(--muted); font-size:10.5px; margin-left:6px;">
              {s.avgComplexity > 8 ? 'high' : s.avgComplexity > 4 ? 'med' : 'low'}
            </span>
          </div>
        </div>
        <div class="section">
          <div class="section-title">Languages</div>
          {#each s.languages as [lang, count] (lang)}
            <div class="lang-row">
              <span class="lang-name">{lang}</span>
              <span class="lang-count">{count.toLocaleString()}</span>
            </div>
          {/each}
          {#if s.languages.length === 0}
            <div class="muted">none</div>
          {/if}
        </div>
        {#if s.topHubs.length > 0}
          <div class="section">
            <div class="section-title">Top hubs (by transitive reach)</div>
            {#each s.topHubs as h (h.symId)}
              <button class="hub-row" on:click={() => jumpToSymbol(h.symId)}>
                <span class="hub-name mono">{h.name}</span>
                <span class="hub-kind">{h.kind}</span>
                <span class="hub-reach" title="symbols that can reach this one">{h.reach}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .pkg-summary {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    font-family: var(--vscode-font-family, 'Manrope', sans-serif);
    color: var(--text);
  }
  .head {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
    padding: 14px 18px; border-bottom: 1px solid var(--border); background: var(--surface);
  }
  .head h1 { margin: 0; font-size: 18px; }
  .head .sub { margin: 4px 0 0 0; color: var(--muted); font-size: 12px; line-height: 1.4; max-width: 620px; }
  .head input {
    background: var(--surface-2); border: 1px solid var(--border); color: var(--text);
    border-radius: 6px; padding: 6px 10px;
    font-family: inherit; font-size: 12.5px; width: 240px; outline: none;
  }
  .head input:focus { border-color: var(--accent); }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
    gap: 14px;
    padding: 14px 18px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }
  .card-head {
    padding: 10px 14px;
    border-left: 3px solid var(--accent);
    background: var(--surface-2);
  }
  .pkg-name { font-weight: 700; font-size: 13px; }
  .kv {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 4px 12px;
    padding: 12px 14px;
    font-size: 12px;
    border-bottom: 1px solid var(--border);
  }
  .kv .k { color: var(--muted); text-transform: uppercase; font-size: 10.5px; letter-spacing: 0.04em; }
  .kv .v { font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); font-size: 12.5px; text-align: right; }
  .section { padding: 10px 14px; border-bottom: 1px solid var(--border); }
  .section:last-child { border-bottom: none; }
  .section-title { color: var(--muted); text-transform: uppercase; font-size: 10.5px; letter-spacing: 0.04em; margin-bottom: 6px; font-weight: 700; }
  .lang-row { display: flex; justify-content: space-between; font-size: 12px; padding: 2px 0; }
  .lang-name { font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); }
  .lang-count { font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); color: var(--muted); font-size: 11px; }
  .muted { color: var(--muted); font-size: 11px; }
  .hub-row {
    display: grid;
    grid-template-columns: 1fr 80px 40px;
    align-items: baseline;
    gap: 8px;
    background: none;
    border: none;
    padding: 4px 0;
    width: 100%;
    text-align: left;
    cursor: pointer;
    color: var(--text);
    font-size: 12px;
  }
  .hub-row:hover { color: var(--accent); }
  .hub-name { font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hub-kind { color: var(--muted); font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; }
  .hub-reach { font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); font-size: 11.5px; color: var(--accent); text-align: right; font-weight: 700; }
</style>