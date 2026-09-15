<script>
  // Per-package rollup view: size (files/symbols/LOC), languages, complexity,
  // docs coverage, entry points, dead code, dependencies, hubs, and hotspots.
  import { DATA, packageFilter, symInAdj, pkgOutAdj, pkgInAdj, deadCodeSymbols } from './stores.js';
  import { jumpToSymbol, openPackage } from './actions.js';
  import { pkgColor, shortPkg, packageSummaries } from './graph.js';

  let query = '';

  $: summaries = packageSummaries(DATA.packages, DATA.files, DATA.symbols, symInAdj, DATA.fileSymbolIds, {
    pkgOutAdj,
    pkgInAdj,
    deadCode: $deadCodeSymbols,
  });

  $: filtered = (() => {
    const q = query.trim().toLowerCase();
    const pkgs = $packageFilter;
    return summaries.filter(s => {
      if (pkgs && !pkgs.has(s.pkgIdx)) return false;
      if (q && !s.name.toLowerCase().includes(q)) return false;
      return true;
    });
  })();

  // Docs-coverage bar color, matching DocsView's thresholds.
  function docsColor(pct) {
    return pct < 25 ? '#c94f7c' : pct < 60 ? '#c9a13f' : '#3fa77f';
  }
</script>

<div class="pkg-summary">
  <div class="head">
    <div>
      <h1>Package summary</h1>
      <p class="sub">Aggregate stats per package — size, docs coverage, entry points, dead code, dependencies, top hubs by transitive reach, and complexity hotspots. Sort or click a row to jump.</p>
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
          <div class="k" data-tip="source files indexed in this package">Files</div><div class="v"><b>{s.fileCount}</b></div>
          <div class="k" data-tip="indexed symbols (functions, methods, classes, components, types, …) across those files">Symbols</div><div class="v"><b>{s.symbolCount}</b></div>
          <div class="k" data-tip="total lines of code across the package's files">LOC</div><div class="v"><b>{s.loc.toLocaleString()}</b></div>
          <div class="k" data-tip="mean heuristic complexity per symbol — if/for/while/case/catch/&&/||/? each add a path">Avg complexity</div>
          <div class="v">
            <b>{s.avgComplexity.toFixed(1)}</b>
            <span style="color:var(--muted); font-size:10.5px; margin-left:6px;">
              {s.avgComplexity > 8 ? 'high' : s.avgComplexity > 4 ? 'med' : 'low'}
            </span>
          </div>
          {#if s.docsTotal > 0}
            <div class="k" data-tip="{s.docsCovered} of {s.docsTotal} exported documentable symbols have a docstring">Docs</div>
            <div class="v">
              <b>{Math.round((s.docsCovered / s.docsTotal) * 100)}%</b>
              <span class="bar-track"><span class="bar-fill" style="width:{(s.docsCovered / s.docsTotal) * 100}%; background:{docsColor((s.docsCovered / s.docsTotal) * 100)}"></span></span>
            </div>
          {/if}
          <div class="k" data-tip="exported symbols with no internal callers (public API), plus framework entry markers (routes, lifecycle hooks, CLI handlers)">Entry pts</div>
          <div class="v"><b>{s.entryCount}</b></div>
          {#if s.deadCount > 0}
            <div class="k" data-tip="symbols nothing calls, references, extends or instantiates — probably removable (see Dead code view)">Dead code</div>
            <div class="v"><b class="dead">{s.deadCount}</b></div>
          {/if}
        </div>
        {#if s.deps.length > 0 || s.rdepCount > 0}
          <div class="section">
            <div class="section-title" data-tip="packages this one imports from or calls into — click a chip to open it. Number = cross-package edges">Dependencies</div>
            {#if s.deps.length > 0}
              <div class="dep-chips">
                {#each s.deps.slice(0, 8) as d (d.pkgIdx)}
                  <button
                    class="dep-chip"
                    style="border-color:{pkgColor(d.pkgIdx)}; color:{pkgColor(d.pkgIdx)}"
                    data-tip="{DATA.packages[d.pkgIdx][0]} · {d.weight} cross-pkg edge{d.weight === 1 ? '' : 's'}"
                    on:click={() => openPackage(d.pkgIdx)}
                  >{shortPkg(DATA.packages[d.pkgIdx][0])}<span class="dep-w">{d.weight}</span></button>
                {/each}
                {#if s.deps.length > 8}<span class="dep-more">+{s.deps.length - 8} more</span>{/if}
              </div>
            {/if}
            {#if s.rdepCount > 0}
              <div class="rdep" data-tip="other packages that import or call into this one">↩ {s.rdepCount} package{s.rdepCount === 1 ? '' : 's'} depend on this</div>
            {/if}
          </div>
        {/if}
        <div class="section">
            <div class="section-title" data-tip="top 3 languages by lines of code">Languages</div>
            {#each s.languages as [lang, count] (lang)}
              <div class="lang-row">
                <span class="lang-name">{lang}</span>
                <span class="lang-count" data-tip="lines of code in {lang}">{count.toLocaleString()}</span>
              </div>
            {/each}
          {#if s.languages.length === 0}
            <div class="muted">none</div>
          {/if}
        </div>
        {#if s.topHubs.length > 0}
          <div class="section">
            <div class="section-title" data-tip="most-depended-on symbols here, ranked by how many symbols can reach them through any call path — kill one and this much breaks">Top hubs (by transitive reach)</div>
            {#each s.topHubs as h (h.symId)}
              <button class="hub-row" on:click={() => jumpToSymbol(h.symId)} data-tip="{DATA.files[DATA.symbols[h.symId][4]][0]}:{DATA.symbols[h.symId][2]} — click to open">
                <span class="hub-name mono">{h.name}</span>
                <span class="hub-kind">{h.kind}</span>
                <span class="hub-reach" data-tip="symbols that can reach this one through any call path">{h.reach}</span>
              </button>
            {/each}
          </div>
        {/if}
        {#if s.hotspot}
          <div class="section">
            <div class="section-title" data-tip="highest-complexity symbol in this package — only shown when complexity is 6 or higher">Complexity hotspot</div>
            <button class="hub-row" on:click={() => jumpToSymbol(s.hotspot.symId)} data-tip="{DATA.files[DATA.symbols[s.hotspot.symId][4]][0]}:{DATA.symbols[s.hotspot.symId][2]} — click to open">
              <span class="hub-name mono">{s.hotspot.name}</span>
              <span class="hub-kind">{s.hotspot.kind}</span>
              <span class="hub-reach hot" data-tip="approx. cyclomatic complexity — refactor candidate">cx {s.hotspot.complexity}</span>
            </button>
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
  .kv .v .dead { color: #c94f7c; }
  .kv .v .bar-track {
    display: inline-block; vertical-align: middle;
    width: 56px; height: 5px; border-radius: 3px;
    background: var(--border); overflow: hidden;
    margin-left: 6px;
  }
  .kv .v .bar-fill { display: block; height: 100%; }
  .dep-chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .dep-chip {
    display: inline-flex; align-items: baseline; gap: 5px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 2px 9px;
    font-size: 11px;
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    cursor: pointer;
  }
  .dep-chip:hover { background: var(--accent-soft); }
  .dep-chip .dep-w { color: var(--muted); font-size: 10px; }
  .dep-more { color: var(--muted); font-size: 10.5px; align-self: center; }
  .rdep { color: var(--muted); font-size: 11px; margin-top: 6px; }
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
  .hub-reach.hot { color: #c94f7c; }
</style>