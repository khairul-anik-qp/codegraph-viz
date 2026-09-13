<script>
  import { DATA } from './stores.js';
  import { jumpToSymbol } from './actions.js';
  import { pkgColor, displayName } from './graph.js';

  // "Documentable" mirrors what actually shows up as a docstring target in
  // practice — exported, non-trivial symbols. Properties/enum members are
  // excluded: they're rarely individually documented and would drown out
  // the packages that actually need attention.
  const DOCUMENTABLE_KINDS = new Set(['function', 'method', 'component', 'class', 'interface', 'type_alias']);

  let query = '';
  let expanded = new Set();

  $: perPkg = (() => {
    const stats = new Map(); // pkgIdx -> { total, documented, undocumented: [] }
    for (let i = 0; i < DATA.symbols.length; i++) {
      const s = DATA.symbols[i];
      if (!s[3]) continue; // exported only — internal helpers aren't part of the public surface
      if (!DOCUMENTABLE_KINDS.has(s[1])) continue;
      const pkgIdx = DATA.files[s[4]][1];
      if (!stats.has(pkgIdx)) stats.set(pkgIdx, { total: 0, documented: 0, undocumented: [] });
      const st = stats.get(pkgIdx);
      st.total++;
      if (s[6]) st.documented++;
      else st.undocumented.push(i);
    }
    return [...stats.entries()]
      .map(([pkgIdx, st]) => ({
        pkgIdx,
        name: DATA.packages[pkgIdx] ? DATA.packages[pkgIdx][0] : '?',
        total: st.total,
        documented: st.documented,
        coverage: st.total > 0 ? st.documented / st.total : 0,
        undocumented: st.undocumented.sort((a, b) => DATA.symbols[a][0].localeCompare(DATA.symbols[b][0])),
      }))
      .filter(p => p.total > 0)
      .sort((a, b) => a.coverage - b.coverage);
  })();

  $: filtered = (() => {
    const q = query.trim().toLowerCase();
    if (!q) return perPkg;
    return perPkg.filter(p => p.name.toLowerCase().includes(q));
  })();

  $: totalDocumentable = perPkg.reduce((n, p) => n + p.total, 0);
  $: totalDocumented = perPkg.reduce((n, p) => n + p.documented, 0);
  $: overallPct = totalDocumentable > 0 ? Math.round((totalDocumented / totalDocumentable) * 100) : 0;

  function toggle(pkgIdx) {
    if (expanded.has(pkgIdx)) expanded.delete(pkgIdx);
    else expanded.add(pkgIdx);
    expanded = new Set(expanded);
  }
</script>

<div class="docs">
  <div class="head">
    <div>
      <h1>Documentation coverage</h1>
      <p class="sub">
        Exported functions/methods/components/classes/interfaces/type-aliases with a docstring, per package.
        <b>{totalDocumented} / {totalDocumentable}</b> covered overall (<b>{overallPct}%</b>). Worst-covered packages first.
      </p>
    </div>
    <input type="text" placeholder="Filter by package…" bind:value={query} />
  </div>

  <div class="rows">
    {#each filtered as p (p.pkgIdx)}
      <div class="group">
        <button class="group-head" on:click={() => toggle(p.pkgIdx)}>
          <span class="chev" class:open={expanded.has(p.pkgIdx)}>▸</span>
          <span class="pkg-dot" style="background:{pkgColor(p.pkgIdx)}"></span>
          <span class="mono name">{p.name}</span>
          <span class="bar-track">
            <span class="bar-fill" style="width:{(p.coverage * 100).toFixed(0)}%; background:{p.coverage < 0.25 ? '#c94f7c' : p.coverage < 0.6 ? '#c9a13f' : '#3fa77f'}"></span>
          </span>
          <span class="pct mono">{(p.coverage * 100).toFixed(0)}%</span>
          <span class="ratio mono">{p.documented}/{p.total}</span>
        </button>
        {#if expanded.has(p.pkgIdx) && p.undocumented.length > 0}
          <div class="undoc-list">
            <div class="undoc-head">undocumented ({p.undocumented.length})</div>
            {#each p.undocumented.slice(0, 60) as symId (symId)}
              <button class="undoc-row" on:click={() => jumpToSymbol(symId)}>
                <span class="mono nm">{DATA.symbols[symId][0]}</span>
                <span class="kind">{DATA.symbols[symId][1]}</span>
                <span class="file mono">{displayName(DATA.files[DATA.symbols[symId][4]][0])}:{DATA.symbols[symId][2]}</span>
              </button>
            {/each}
            {#if p.undocumented.length > 60}
              <div class="undoc-more">+{p.undocumented.length - 60} more</div>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
    {#if filtered.length === 0}
      <div class="empty">No packages match the current filter.</div>
    {/if}
  </div>
</div>

<style>
  .docs {
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
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
  .head .sub { margin: 4px 0 0 0; color: var(--muted); font-size: 12px; line-height: 1.4; max-width: 640px; }
  .head .sub b { color: var(--text); font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); }
  .head input {
    background: var(--surface-2); border: 1px solid var(--border); color: var(--text);
    border-radius: 6px; padding: 6px 10px;
    font-family: inherit; font-size: 12.5px; width: 220px; outline: none; flex: 0 0 auto;
  }
  .head input:focus { border-color: var(--accent); }

  .rows { overflow-y: auto; flex: 1; padding: 10px 0 20px; }
  .group { margin: 0 18px 8px; }
  .group-head {
    display: grid;
    grid-template-columns: 14px 9px 1fr 160px 44px 60px;
    align-items: center;
    gap: 10px;
    width: 100%;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 12px;
    cursor: pointer;
    text-align: left;
  }
  .group-head:hover { background: var(--accent-soft); }
  .chev { color: var(--muted); font-size: 10px; transition: transform 0.1s ease; }
  .chev.open { transform: rotate(90deg); }
  .pkg-dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
  .name { font-size: 12.5px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-track { height: 6px; border-radius: 3px; background: var(--border); overflow: hidden; }
  .bar-fill { display: block; height: 100%; }
  .pct { font-size: 11.5px; font-weight: 700; text-align: right; }
  .ratio { font-size: 10.5px; color: var(--muted); text-align: right; }

  .undoc-list {
    margin: 4px 4px 0 32px;
    border-left: 2px solid var(--border);
    padding-left: 10px;
  }
  .undoc-head {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--muted); padding: 4px 0;
  }
  .undoc-row {
    display: grid;
    grid-template-columns: 1fr 90px 1fr;
    gap: 10px;
    width: 100%;
    background: none; border: none;
    padding: 4px 6px;
    cursor: pointer;
    text-align: left;
    font-size: 12px;
    border-radius: 5px;
  }
  .undoc-row:hover { background: var(--accent-soft); }
  .undoc-row .nm { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .undoc-row .kind { color: var(--muted); font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); font-size: 10px; text-transform: uppercase; }
  .undoc-row .file { color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .undoc-more { padding: 4px 6px; color: var(--muted); font-size: 11px; }
  .empty { padding: 30px; text-align: center; color: var(--muted); font-size: 13px; }
</style>
