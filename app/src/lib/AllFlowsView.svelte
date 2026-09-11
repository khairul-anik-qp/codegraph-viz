<script>
  import {
    DATA,
    allFlowsRoot,
    allFlowsCallerPaths,
    allFlowsCalleePaths,
    allFlowsCaps,
    allFlowsTruncated,
    packageFilter,
    cycleGroups,
    namedFlows,
    setFlowName,
    getFlowName,
    pathHash,
    inspectedPath,
    symInAdj,
  } from "./stores.js";
  import { jumpToSymbol, recomputeAllFlows, openFlow } from "./actions.js";
  import { pkgColor, displayName, findEntryPathsToSymbol } from "./graph.js";
  import PathSnippetCard from "./PathSnippetCard.svelte";
  import PathInspector from "./PathInspector.svelte";

  $: rootId = $allFlowsRoot;
  $: rootSym = rootId !== null ? DATA.symbols[rootId] : null;
  $: rootFile = rootSym ? DATA.files[rootSym[4]] : null;
  $: caps = $allFlowsCaps;

  let expanded = new Set();
  let snippetPath = null;
  let groupByLeafPkg = true;
  let dedup = true;
  let sortBy = "length"; // 'length' | 'leaf' | 'pkg'

  function toggleExpand(key) {
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
    expanded = new Set(expanded);
  }
  function showSnippet(key) {
    snippetPath = snippetPath === key ? null : key;
  }

  function symChipLabel(symId) {
    return DATA.symbols[symId][0];
  }
  function symChipTitle(symId) {
    const s = DATA.symbols[symId];
    const file = DATA.files[s[4]];
    return `${s[1]} · ${file[0]}`;
  }
  function pkgOf(symId) {
    return DATA.files[DATA.symbols[symId][4]][1];
  }
  function leafFile(symId) {
    return DATA.files[DATA.symbols[symId][4]][0];
  }
  function leafPkgName(symId) {
    const idx = pkgOf(symId);
    return DATA.packages[idx] ? DATA.packages[idx][0].split("/").pop() : "?";
  }

  function comparePaths(a, b) {
    if (sortBy === "length") {
      const d = a.length - b.length;
      if (d !== 0) return d;
    }
    const ap = leafPkgName(a[a.length - 1]);
    const bp = leafPkgName(b[b.length - 1]);
    if (ap !== bp) return ap < bp ? -1 : 1;
    return 0;
  }

  function sortAndGroup(paths) {
    const sorted = paths.slice().sort(comparePaths);
    let deduped = sorted;
    if (dedup) {
      // Collapse paths that share their first 3 nodes into one row with a
      // "×N more" hint, so a 500-path explosion through the same hub doesn't
      // render 500 visually identical rows. Prefix length 3 covers most
      // meaningful branching (one hop → branch point → first divergent call).
      const seen = new Map();
      deduped = [];
      for (const p of sorted) {
        const key = p.slice(0, 3).join("→");
        if (seen.has(key)) {
          seen.get(key).count++;
        } else {
          seen.set(key, { path: p, count: 1 });
          deduped.push({ path: p, count: 1 });
        }
      }
      deduped = deduped.map((d) => d.path);
    }
    if (!groupByLeafPkg) return [{ name: "All paths", paths: deduped }];
    const groups = new Map();
    for (const p of deduped) {
      const key = leafPkgName(p[p.length - 1]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([name, ps]) => ({ name, paths: ps }));
  }

  $: callerGroups = sortAndGroup($allFlowsCallerPaths);
  $: calleeGroups = sortAndGroup($allFlowsCalleePaths);

  // "Started by" — entry points whose call chain reaches the current
  // root, with the full breadcrumb so the user can see what kicked off
  // each path. Complements the per-row caller paths: those start at the
  // root and walk outward, these start at the entry and walk inward.
  $: entryPaths = rootId !== null ? findEntryPathsToSymbol(rootId, symInAdj, DATA.symbols, DATA.files, 12) : [];

  // Named-flows panel: filter the global map to entries belonging to the
  // current rootId. The map is keyed `${rootId}:${pathHash}`; we strip the
  // root prefix to get just the hash for lookups against the current paths.
  $: rootPrefix = `${rootId}:`;
  $: namedForRoot = (() => {
    const out = [];
    for (const [k, name] of Object.entries($namedFlows)) {
      if (!k.startsWith(rootPrefix)) continue;
      const hash = k.slice(rootPrefix.length);
      // Find the matching path in either callers or callees.
      const path = [...$allFlowsCallerPaths, ...$allFlowsCalleePaths].find((p) => pathHash(p) === hash);
      if (!path) continue;
      const dir = $allFlowsCallerPaths.some((p) => pathHash(p) === hash) ? "callers" : "callees";
      out.push({ name, path, dir, hash });
    }
    return out;
  })();

  function focusPath(path, dir) {
    inspectedPath.set({ rootId, dir, path, name: getFlowName(rootId, path) });
  }

  // Auto-derived default name for a path — what we'd suggest if the user
  // hasn't named it. Concise: "rootName → firstCaller → lastLeaf" so the
  // row is scannable without it being a wall of chips.
  function suggestName(path) {
    if (!path || path.length === 0) return "";
    const last = path[path.length - 1];
    const first = path[1] || path[0]; // skip the root when it's the first hop
    const lastNm = DATA.symbols[last]?.[0] || "?";
    if (first === path[0]) return lastNm;
    const firstNm = DATA.symbols[first]?.[0] || "?";
    return `${firstNm} → ${lastNm}`;
  }
  function onNameBlur(rootId, path, value) {
    setFlowName(rootId, path, value);
  }

  function snippetFor(symId) {
    const s = DATA.symbols[symId];
    return s[5] || "";
  }

  // Returns the name(s) of any strongly-connected call cycle the path enters
  // (excluding the root itself, since the path's start isn't "entering" a
  // cycle, it just is one). Empty array if the path is acyclic.
  function pathCycles(path) {
    const cg = $cycleGroups;
    if (!cg || !cg.map || !cg.sccs) return [];
    const m = cg.map;
    const seen = new Set();
    const cycles = [];
    for (const id of path) {
      if (!m.has(id)) continue;
      const sccIdx = m.get(id);
      if (seen.has(sccIdx)) continue;
      seen.add(sccIdx);
      const scc = cg.sccs[sccIdx];
      if (!scc || scc.length < 2) continue;
      const label = scc
        .map((i) => (DATA.symbols[i] && DATA.symbols[i][0]) || "?")
        .slice(0, 3)
        .join(" ↔ ");
      cycles.push(label + (scc.length > 3 ? ` +${scc.length - 3}` : ""));
    }
    return cycles;
  }

</script>

{#if rootSym}
  {#if $inspectedPath && $inspectedPath.rootId === rootId}
    <PathInspector />
  {:else}
    <div class="all-flows">
      <div class="root-banner">
        <div class="root-name">
          <span class="kind">{rootSym[1]}</span>
          <span class="mono">{rootSym[0]}</span>
        </div>
        <div class="root-meta">
          in <button class="file-link mono" on:click={() => jumpToSymbol(rootId)} title={rootFile[0]}
            >{displayName(rootFile[0])}</button
          >
          <span class="sep">·</span>
          <button
            class="single-flow-link"
            on:click={() => openFlow(rootId, "out")}
            title="Open the single-flow d3 tree view instead">d3 flow →</button
          >
        </div>
      </div>

      <div class="controls">
        <div class="ctrl-row">
          <span class="ctrl-label">depth <b>{caps.depth}</b></span>
          <span class="ctrl-label">max paths <b>{caps.maxPaths}</b></span>
          <span class="ctrl-label">max children <b>{caps.maxChildren}</b></span>
          <button class="pill" on:click={recomputeAllFlows}>re-enumerate</button>
        </div>
        <div class="ctrl-row">
          <span class="ctrl-label">sort</span>
          <div class="seg">
            {#each [{ k: "length", l: "length" }, { k: "leaf", l: "leaf pkg" }] as o}
              <button class:active={sortBy === o.k} on:click={() => (sortBy = o.k)}>{o.l}</button>
            {/each}
          </div>
          <span class="ctrl-label">group by leaf package</span>
          <button
            class="switch"
            class:on={groupByLeafPkg}
            on:click={() => (groupByLeafPkg = !groupByLeafPkg)}
            aria-pressed={groupByLeafPkg}><span class="knob"></span></button
          >
          <span class="ctrl-label">dedup shared prefixes</span>
          <button class="switch" class:on={dedup} on:click={() => (dedup = !dedup)} aria-pressed={dedup}
            ><span class="knob"></span></button
          >
        </div>
      </div>

      {#if namedForRoot.length > 0}
        <section class="named-section">
          <header>
            <h2>named flows</h2>
            <span class="count">{namedForRoot.length}</span>
          </header>
          <div class="named-list">
            {#each namedForRoot as n (n.hash)}
              <div class="named-row">
                <button class="named-focus" on:click={() => focusPath(n.path, n.dir)} title="Focus this flow">
                  <span class="named-arrow">{n.dir === "callers" ? "↑" : "↓"}</span>
                  <span class="named-name">{n.name}</span>
                  <span class="named-count">{n.path.length} nodes</span>
                </button>
                <button class="named-unname" on:click={() => setFlowName(rootId, n.path, "")} title="Unname">✕</button>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      {#if entryPaths.length > 0}
        <section class="started-by">
          <header>
            <h2>Started by entry points ({entryPaths.length})</h2>
            <span
              class="count"
              title="Entry points (zero-callers exports + framework entry markers) that can reach this symbol"
            >
              entry → … → {DATA.symbols[rootId]?.[0] || "root"}
            </span>
          </header>
          {#each entryPaths as ep, i (ep.entryId + ":" + i)}
            <div class="entry-row">
              <div class="entry-row-head">
                <button class="entry-name mono" on:click={() => jumpToSymbol(ep.entryId)} title={ep.entryFile}>
                  {ep.entryName}
                </button>
                <span class="entry-kind">{ep.entryKind}</span>
                <span class="entry-file" title={ep.entryFile}>· {displayName(ep.entryFile)}</span>
                <span class="entry-len" title="chain length">{ep.length} hops</span>
              </div>
              <div class="entry-chain">
                {#each ep.path as id, j (j + ":" + id + ":" + i)}
                  {#if j > 0}<span class="entry-chev">→</span>{/if}
                  <button
                    class="entry-chip"
                    class:origin={j === 0}
                    class:target={id === rootId}
                    title={DATA.symbols[id]
                      ? `${DATA.symbols[id][1]} · ${DATA.files[DATA.symbols[id][4]]?.[0] || ""}`
                      : ""}
                    on:click={() => jumpToSymbol(id)}>{DATA.symbols[id]?.[0] || "?"}</button
                  >
                {/each}
              </div>
            </div>
          {/each}
        </section>
      {/if}

      {#each [{ label: "Callers — who calls this", paths: callerGroups, dir: "callers" }, { label: "Callees — what this calls", paths: calleeGroups, dir: "callees" }] as section (section.label)}
        <section>
          <header>
            <h2>{section.label}</h2>
            <span class="count">
              {$allFlowsCallerPaths.length + $allFlowsCalleePaths.length === 0
                ? 0
                : section.paths.reduce((n, g) => n + g.paths.length, 0)} path{section.paths.reduce(
                (n, g) => n + g.paths.length,
                0,
              ) === 1
                ? ""
                : "s"}
              {#if $allFlowsTruncated[section.dir]}<span class="trunc" title="Hit max-paths cap; raise it to see more">
                  · truncated</span
                >{/if}
            </span>
          </header>
          <div class="path-list">
            {#each section.paths as group (group.name)}
              <div class="pkg-group">
                <div class="pkg-group-head">
                  <span class="pkg-name">{group.name}</span>
                  <span class="pkg-count">{group.paths.length}</span>
                </div>
                {#each group.paths as path, i (section.label + ":" + group.name + ":" + i)}
                  {@const key = section.label + ":" + group.name + ":" + i}
                  {@const savedName = getFlowName(rootId, path)}
                  <div class="path-row" style="--row-accent: {pkgColor(pkgOf(path[0]))}">
                    <button
                      class="expander"
                      class:open={expanded.has(key) || snippetPath === key}
                      on:click={() => toggleExpand(key)}
                      title="Expand row">▸</button
                    >
                    <span class="len-badge" title="path length">len {path.length}</span>
                    {#each pathCycles(path) as cyc (cyc)}
                      <span class="cycle-badge" title="Path enters a call cycle">⟲ {cyc}</span>
                    {/each}
                    <div class="chips">
                      {#each section.dir === "callers" ? path.slice().reverse() : path as symId, j (j)}
                        {#if j > 0}<span class="chev">→</span>{/if}
                        <button
                          class="chip"
                          class:root={symId === rootId}
                          class:dimmed={$packageFilter && !$packageFilter.has(pkgOf(symId))}
                          title={symChipTitle(symId)}
                          on:click={() => jumpToSymbol(symId)}>{symChipLabel(symId)}</button
                        >
                      {/each}
                    </div>
                    <input
                      class="name-input"
                      type="text"
                      placeholder={savedName ? "" : suggestName(path)}
                      value={savedName}
                      on:blur={(e) => onNameBlur(rootId, path, e.target.value)}
                      on:keydown={(e) => {
                        if (e.key === "Enter") e.target.blur();
                      }}
                      title="Name this flow (Enter to save)"
                    />
                    <button
                      class="focus-btn"
                      on:click={() => focusPath(path, section.dir)}
                      title="View this flow in isolation">focus →</button
                    >
                    <button
                      class="snippet-toggle"
                      class:on={snippetPath === key}
                      on:click={() => showSnippet(key)}
                      title="Show source snippet for the root node">src</button
                    >
                  </div>
                  {#if expanded.has(key)}
                    {@const orderedPath = section.dir === "callers" ? path.slice().reverse() : path}
                    <div class="snippet-pane">
                      <div class="snippet-pane-head">walk this path &middot; click any node to jump</div>
                      <div class="snippet-grid">
                        {#each orderedPath as symId, j (j)}
                          <PathSnippetCard
                            {symId}
                            idx={j}
                            isRoot={symId === rootId}
                            calleeSymId={j < orderedPath.length - 1 ? orderedPath[j + 1] : null}
                          />
                        {/each}
                      </div>
                    </div>
                  {:else if snippetPath === key}
                    <div class="snippet-pane">
                      <div class="snippet-pane-head">
                        root node source &middot; <span class="mono">{rootSym[0]}</span>
                      </div>
                      <pre class="snippet-pre single">{snippetFor(rootId)}</pre>
                    </div>
                  {/if}
                {/each}
                {#if group.paths.length === 0}
                  <div class="empty">No paths in this group.</div>
                {/if}
              </div>
            {/each}
            {#if section.paths.length === 0}
              <div class="empty">
                No {section.label.startsWith("Callers") ? "callers" : "callees"} in the current graph.
              </div>
            {/if}
          </div>
        </section>
      {/each}
    </div>
  {/if}
{:else}
  <div class="empty">No symbol selected. Search for a function and click <b>all</b>.</div>
{/if}

<style>
  .all-flows {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    padding: 16px 20px 32px;
    font-family: "Manrope", sans-serif;
    color: var(--text);
  }
  .root-banner {
    display: flex;
    align-items: baseline;
    gap: 14px;
    padding: 10px 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: 8px;
    margin-bottom: 12px;
  }
  .root-name {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
  }
  .root-name .kind {
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .root-name .mono {
    font-family: "JetBrains Mono", monospace;
    font-weight: 700;
    font-size: 16px;
  }
  .root-meta {
    color: var(--muted);
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .root-meta .sep {
    opacity: 0.5;
  }
  .file-link,
  .single-flow-link {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--accent);
    font-weight: 600;
    font-family: "JetBrains Mono", monospace;
  }
  .file-link:hover,
  .single-flow-link:hover {
    text-decoration: underline;
  }

  .controls {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 12px;
    background: var(--surface-2);
    border-radius: 6px;
    margin-bottom: 16px;
    font-size: 11px;
    color: var(--muted);
  }
  .ctrl-row {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
  }
  .ctrl-label {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .ctrl-label b {
    color: var(--text);
    font-weight: 700;
    font-family: "JetBrains Mono", monospace;
  }

  section {
    margin-bottom: 24px;
  }
  section header {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 8px;
  }
  section h2 {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
    color: var(--text);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .count {
    font-size: 12px;
    color: var(--muted);
    font-family: "JetBrains Mono", monospace;
  }
  .trunc {
    color: #c94f7c;
    font-weight: 700;
  }

  .path-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .pkg-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .pkg-group-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 4px 2px;
    margin-top: 6px;
    border-bottom: 1px solid var(--border);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .pkg-group-head .pkg-name {
    color: var(--text);
    font-weight: 700;
    font-family: "JetBrains Mono", monospace;
  }
  .pkg-group-head .pkg-count {
    margin-left: auto;
    color: var(--muted);
    font-family: "JetBrains Mono", monospace;
  }

  .path-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-left: 3px solid var(--row-accent, var(--border));
    border-radius: 6px;
    flex-wrap: wrap;
  }
  .expander {
    flex: 0 0 auto;
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-family: "JetBrains Mono", monospace;
    font-size: 12px;
    padding: 0 2px;
    transition: transform 0.15s ease;
  }
  .expander.open {
    transform: rotate(90deg);
    color: var(--accent);
  }
  .expander:hover {
    color: var(--accent);
  }
  .len-badge {
    flex: 0 0 auto;
    font-family: "JetBrains Mono", monospace;
    font-size: 10px;
    color: var(--muted);
    background: var(--surface-2);
    padding: 2px 5px;
    border-radius: 3px;
  }
  .cycle-badge {
    flex: 0 0 auto;
    font-family: "JetBrains Mono", monospace;
    font-size: 10px;
    color: #c9a13f;
    background: rgba(201, 161, 63, 0.12);
    border: 1px solid rgba(201, 161, 63, 0.35);
    padding: 2px 7px;
    border-radius: 10px;
    white-space: nowrap;
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chips {
    display: flex;
    align-items: center;
    gap: 4px;
    overflow-x: auto;
    flex: 1 1 240px;
    min-width: 0;
    padding-bottom: 1px; /* keep scrollbar off the rounded edge */
  }
  .chip {
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 5px;
    padding: 3px 8px;
    font-family: "JetBrains Mono", monospace;
    font-size: 11.5px;
    cursor: pointer;
    flex: 0 0 auto;
  }
  .chip:hover {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  .chip.root {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
    font-weight: 700;
  }
  .chip.root:hover {
    filter: brightness(1.1);
  }
  .chip.dimmed {
    opacity: 0.4;
  }
  .chev {
    color: var(--muted);
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    flex: 0 0 auto;
  }

  .snippet-toggle {
    flex: 0 0 auto;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--muted);
    border-radius: 4px;
    padding: 2px 7px;
    font-family: "JetBrains Mono", monospace;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    cursor: pointer;
  }
  .snippet-toggle:hover {
    color: var(--text);
    border-color: var(--accent);
  }
  .snippet-toggle.on {
    background: var(--accent-soft);
    color: var(--accent);
    border-color: var(--accent);
  }

  .snippet-pane {
    margin: 0 0 4px 0;
    padding: 10px 12px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .snippet-pane-head {
    font-size: 10.5px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 6px;
  }
  .snippet-pane-head .mono {
    color: var(--accent);
    font-weight: 700;
  }
  .snippet-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 8px;
  }
  .snippet-pre {
    margin: 0;
    padding: 8px 10px;
    font-family: "JetBrains Mono", monospace;
    font-size: 10.5px;
    line-height: 1.4;
    color: var(--text);
    background: var(--surface);
    overflow-x: auto;
    white-space: pre;
    max-height: 200px;
    overflow-y: auto;
  }
  .snippet-pre.single {
    white-space: pre-wrap;
  }

  .empty {
    padding: 16px;
    text-align: center;
    color: var(--muted);
    font-size: 13px;
    background: var(--surface);
    border: 1px dashed var(--border);
    border-radius: 6px;
  }
  .pill {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--accent);
    background: var(--accent-soft);
    border: none;
    border-radius: 6px;
    padding: 4px 10px;
    cursor: pointer;
  }
  .pill:hover {
    filter: brightness(1.1);
  }
  .seg {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }
  .seg button {
    background: var(--surface);
    color: var(--muted);
    border: none;
    border-right: 1px solid var(--border);
    padding: 4px 10px;
    cursor: pointer;
    font: inherit;
  }
  .seg button:last-child {
    border-right: none;
  }
  .seg button.active {
    background: var(--accent);
    color: white;
  }
  .switch {
    width: 32px;
    height: 18px;
    border-radius: 10px;
    background: var(--border);
    position: relative;
    cursor: pointer;
    flex: 0 0 auto;
    padding: 0;
    border: none;
  }
  .switch.on {
    background: var(--accent);
  }
  .switch .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: white;
    transition: transform 0.15s ease;
  }
  .switch.on .knob {
    transform: translateX(14px);
  }

  /* Named flows — the per-row name input + focus button + the saved
     panel at the top. flex-shrink:0 so they never get pushed off the
     right when the chips area overflows. */
  .name-input {
    flex: 0 0 180px;
    min-width: 120px;
    max-width: 220px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 3px 7px;
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    color: var(--text);
  }
  .name-input::placeholder {
    color: var(--muted);
    font-style: italic;
  }
  .name-input:focus {
    outline: none;
    border-color: var(--accent);
    background: var(--surface);
  }
  .focus-btn {
    flex: 0 0 auto;
    background: var(--accent-soft);
    border: 1px solid transparent;
    color: var(--accent);
    border-radius: 4px;
    padding: 3px 9px;
    font-family: "JetBrains Mono", monospace;
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    cursor: pointer;
  }
  .focus-btn:hover {
    background: var(--accent);
    color: white;
  }

  .named-section {
    margin-bottom: 18px;
  }
  .named-section header {
    margin-bottom: 6px;
  }

  /* "Started by entry points" — paths from entry → ... → current root.
     Complements the existing caller list (which starts at root and
     walks outward) by showing the reverse: which entry point started
     each inbound chain. */
  .started-by {
    margin-bottom: 18px;
  }
  .started-by header {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 8px;
  }
  .started-by h2 {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text);
  }
  .started-by .count {
    font-size: 11px;
    color: var(--muted);
    font-family: "JetBrains Mono", monospace;
  }
  .entry-row {
    margin-bottom: 6px;
    padding: 6px 8px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .entry-row-head {
    display: flex;
    align-items: baseline;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 4px;
  }
  .entry-name {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--accent);
    font-weight: 700;
    font-size: 12px;
  }
  .entry-name:hover {
    text-decoration: underline;
  }
  .entry-kind {
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 1px 5px;
  }
  .entry-file {
    font-size: 10.5px;
    color: var(--muted);
    font-family: "JetBrains Mono", monospace;
  }
  .entry-len {
    margin-left: auto;
    font-family: "JetBrains Mono", monospace;
    font-size: 10px;
    color: var(--muted);
  }
  .entry-chain {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-wrap: wrap;
  }
  .entry-chip {
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 4px;
    padding: 2px 6px;
    font-family: "JetBrains Mono", monospace;
    font-size: 10.5px;
    cursor: pointer;
  }
  .entry-chip:hover {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  .entry-chip.origin {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
    font-weight: 700;
  }
  .entry-chip.origin:hover {
    filter: brightness(1.1);
  }
  .entry-chip.target {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 700;
  }
  .entry-chev {
    color: var(--muted);
    font-size: 10px;
  }
  .named-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .named-row {
    display: flex;
    align-items: stretch;
    background: var(--accent-soft);
    border: 1px solid var(--accent);
    border-radius: 6px;
    overflow: hidden;
  }
  .named-focus {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 12px;
    background: none;
    border: none;
    color: var(--text);
    font-family: inherit;
    font-size: 12.5px;
    cursor: pointer;
    text-align: left;
  }
  .named-focus:hover {
    background: rgba(91, 94, 214, 0.18);
  }
  .named-arrow {
    color: var(--accent);
    font-family: "JetBrains Mono", monospace;
    font-weight: 700;
  }
  .named-name {
    font-weight: 700;
  }
  .named-count {
    margin-left: auto;
    color: var(--muted);
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
  }
  .named-unname {
    flex: 0 0 auto;
    background: none;
    border: none;
    border-left: 1px solid var(--accent);
    color: var(--accent);
    cursor: pointer;
    padding: 0 12px;
    font-family: inherit;
    font-size: 14px;
  }
  .named-unname:hover {
    background: var(--accent);
    color: white;
  }

</style>
