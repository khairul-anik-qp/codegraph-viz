<script>
  // Lists symbols that are never called and never referenced/extended/instantiated, ranked by severity.
  import { DATA, deadCodeSymbols, symbolKindFilter, packageFilter } from "./stores.js";
  import { jumpToSymbol } from "./actions.js";
  import { pkgColor, displayName } from "./graph.js";

  let sortKey = "severity"; // 'severity' | 'name' | 'kind' | 'pkg' | 'file'
  let sortDir = 1;
  let query = "";

  // Interfaces, type aliases, constants, enums, etc. are never "called" —
  // even fully-used ones have zero calls-in, they're just reached through
  // references/extends/instantiates instead (which findDeadCode now checks
  // too). They're still noisier to review than an actual dead function, so
  // default to hiding them; the toggle un-hides for a full audit.
  const CALLABLE_KINDS = new Set(["function", "method", "component"]);
  let callableOnly = true;

  $: filteredDead = (() => {
    const q = query.trim().toLowerCase();
    const kinds = $symbolKindFilter;
    return $deadCodeSymbols
      .filter((d) => {
        if (callableOnly && !CALLABLE_KINDS.has(d.kind)) return false;
        if (kinds && !kinds.has(d.kind)) return false;
        if ($packageFilter) {
          const pkgIdx = DATA.files[DATA.symbols[d.symId][4]][1];
          if (!$packageFilter.has(pkgIdx)) return false;
        }
        if (q && !d.name.toLowerCase().includes(q)) return false;
        return true;
      })
      .map((d) => {
        const sym = DATA.symbols[d.symId];
        const file = DATA.files[sym[4]];
        return {
          ...d,
          filePath: file[0],
          pkgIdx: file[1],
          pkgName: DATA.packages[file[1]] ? DATA.packages[file[1]][0].split("/").pop() : "?",
          startLine: sym[2],
          snippet: (sym[5] || "").split("\n")[0],
          severity: d.exported ? 1 : 2,
        };
      })
      .sort((a, b) => {
        const av = a[sortKey],
          bv = b[sortKey];
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * sortDir;
        return (av < bv ? -1 : av > bv ? 1 : 0) * sortDir;
      });
  })();

  $: definiteCount = filteredDead.filter((d) => d.severity === 2).length;
  $: likelyCount = filteredDead.filter((d) => d.severity === 1).length;

  // Toggles sort column, flipping direction if the same column is clicked again.
  function setSort(key) {
    if (sortKey === key) sortDir = -sortDir;
    else {
      sortKey = key;
      sortDir = 1;
    }
  }
</script>

<div class="dead-code">
  <div class="head">
    <div>
      <h1>Dead code</h1>
      <p class="sub">
        Symbols never called <i>and</i> never referenced, extended, implemented, or instantiated elsewhere.
        <b>{definiteCount}</b> definitely dead (un-exported) and
        <b>{likelyCount}</b> likely dead (exported but unreached — could be an entry point, framework callback, or a missed
        wiring).
      </p>
    </div>
    <div class="head-controls">
      <input type="text" placeholder="Filter by name…" bind:value={query} />
      <label class="callable-toggle" title="Interfaces, type aliases, constants, etc. are never 'called' — they're reached via references/extends/instantiates instead, which is noisier to review one-by-one.">
        <input type="checkbox" bind:checked={callableOnly} />
        functions/methods/components only
      </label>
    </div>
  </div>
  <div class="header-row">
    <button class="col-h" class:active={sortKey === "severity"} on:click={() => setSort("severity")}>
      {sortKey === "severity" ? (sortDir === 1 ? "↓ " : "↑ ") : ""}severity
    </button>
    <button class="col-h" class:active={sortKey === "name"} on:click={() => setSort("name")}>
      {sortKey === "name" ? (sortDir === 1 ? "↓ " : "↑ ") : ""}name
    </button>
    <button class="col-h" class:active={sortKey === "kind"} on:click={() => setSort("kind")}>
      {sortKey === "kind" ? (sortDir === 1 ? "↓ " : "↑ ") : ""}kind
    </button>
    <button class="col-h" class:active={sortKey === "pkg"} on:click={() => setSort("pkgName")}>
      {sortKey === "pkg" ? (sortDir === 1 ? "↓ " : "↑ ") : ""}pkg
    </button>
    <button class="col-h" class:active={sortKey === "file"} on:click={() => setSort("filePath")}>
      {sortKey === "file" ? (sortDir === 1 ? "↓ " : "↑ ") : ""}file
    </button>
  </div>
  <div class="rows">
    {#each filteredDead as d (d.symId)}
      <button class="row" on:click={() => jumpToSymbol(d.symId)}>
        <span
          class="sev sev-{d.severity}"
          title={d.severity === 2
            ? "un-exported + zero callers = definitely dead"
            : "exported + zero callers = likely dead"}
        >
          {d.severity === 2 ? "✕" : "?"}
        </span>
        <span class="mono name">{d.name}</span>
        <span class="kind">{d.kind}</span>
        <span class="pkg" style="color:{pkgColor(d.pkgIdx)}">{d.pkgName}</span>
        <span class="file mono" title={d.filePath}
          >{displayName(d.filePath)}<span class="line">:{d.startLine}</span></span
        >
      </button>
    {/each}
    {#if filteredDead.length === 0}
      <div class="empty">No dead code matches the current filters.</div>
    {/if}
  </div>
</div>

<style>
  .dead-code {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    font-family: var(--vscode-font-family, "Manrope", sans-serif);
    color: var(--text);
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 16px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .head h1 {
    margin: 0;
    font-size: 18px;
  }
  .head .sub {
    margin: 4px 0 0 0;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.4;
    max-width: 640px;
  }
  .head .sub b {
    color: var(--text);
    font-family: var(--vscode-editor-font-family, "JetBrains Mono", monospace);
  }
  .head input[type="text"] {
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 6px 10px;
    font-family: inherit;
    font-size: 12.5px;
    width: 240px;
    outline: none;
  }
  .head input[type="text"]:focus {
    border-color: var(--accent);
  }
  .head-controls {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    border-radius: 8px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  }
  .callable-toggle {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    cursor: pointer;
  }
  .callable-toggle input {
    margin: 0;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .header-row,
  .row {
    display: grid;
    grid-template-columns: 72px 1fr 100px 100px 1fr;
    align-items: center;
    gap: 8px;
    padding: 6px 18px;
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
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--muted);
    font: inherit;
    text-transform: inherit;
    letter-spacing: inherit;
    text-align: left;
  }
  .col-h.active {
    color: var(--accent);
    font-weight: 700;
  }
  .rows {
    overflow-y: auto;
    flex: 1;
  }
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
  .row:hover {
    background: var(--accent-soft);
  }
  .row .sev {
    font-family: var(--vscode-editor-font-family, "JetBrains Mono", monospace);
    font-weight: 700;
    text-align: center;
  }
  .sev-1 {
    color: #c9a13f;
  }
  .sev-2 {
    color: #c94f7c;
  }
  .row .name {
    font-weight: 700;
  }
  .row .kind {
    color: var(--muted);
    font-family: var(--vscode-editor-font-family, "JetBrains Mono", monospace);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .row .pkg {
    font-family: var(--vscode-editor-font-family, "JetBrains Mono", monospace);
    font-size: 11.5px;
  }
  .row .file {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-size: 11.5px;
  }
  .row .file .line {
    color: var(--accent);
  }
  .empty {
    padding: 30px;
    text-align: center;
    color: var(--muted);
    font-size: 13px;
  }
</style>
