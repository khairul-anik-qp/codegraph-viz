<script>
  // Single-symbol D3 tree view: renders the call graph rooted at one symbol as a zoomable, drillable tree with a ghost trail of navigation history.
  import { onMount, onDestroy } from 'svelte';
  import * as d3 from 'd3';
  import { DATA, symOutAdj, symInAdj, flowRoot, flowDirection, flowDepth, flowFeatureFilter, packageFilter, flowTrail, tooltipState, diffOverlayOn, changedSymIds, blastRadiusSymIds, searchQuery, symbolKindFilter } from './stores.js';
  import { flowDrillTo, flowJumpToTrail, openAllFlows, openFlow } from './actions.js';
  import { buildFlowTree, pkgColor, displayName, featureGroup } from './graph.js';
  import ExportMenu from './ExportMenu.svelte';

  // The search box is local to this screen — reset it on every mount so
  // re-entering the flow view (e.g. via the nav) doesn't show a stale query
  // left over from a previous visit.
  onMount(() => {
    searchQuery.set('');
    symbolKindFilter.set(null);
  });

  // Pre-collect every distinct symbol-kind present in DATA so the filter
  // chips below show only kinds that actually exist in this codebase.
  $: availableKinds = (() => {
    const set = new Set();
    for (const s of DATA.symbols) set.add(s[1]);
    return [...set].sort();
  })();

  // Adds/removes a symbol kind from the active kind filter, clearing the
  // filter entirely once every kind (or none) is selected.
  function toggleKind(k) {
    symbolKindFilter.update(cur => {
      const next = new Set(cur || []);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next.size === 0 || next.size === availableKinds.length ? null : next;
    });
  }
  // Resets the symbol-kind filter so search shows every kind again.
  function clearKindFilter() { symbolKindFilter.set(null); }

  $: symbolHits = (() => {
    const q = $searchQuery.trim();
    if (!q) return [];
    const out = [];
    const kinds = $symbolKindFilter;
    const needle = q.toLowerCase();
    for (let i = 0; i < DATA.symbols.length && out.length < 20; i++) {
      const s = DATA.symbols[i];
      if ($packageFilter && !$packageFilter.has(DATA.files[s[4]][1])) continue;
      if (kinds && !kinds.has(s[1])) continue;
      if (s[0] && s[0].toLowerCase().includes(needle)) out.push(i);
    }
    return out;
  })();

  let svgEl;
  let gEl;
  let ghostsEl;
  let zoomBehavior;

  const NODE_W = 190;
  const NODE_H = 46;
  const H_GAP = 70;
  const V_GAP = 14;

  let root = null;
  let curDepth = 0;
  let curDir = 'out';

  $: root = $flowRoot;
  $: curDepth = $flowDepth;
  $: curDir = $flowDirection;
  $: adj = curDir === 'out' ? symOutAdj : symInAdj;
  $: fullTree = root !== null
    ? buildFlowTree(DATA.symbols, DATA.files, adj, root, curDepth, $packageFilter)
    : null;
  $: treeData = fullTree && $flowFeatureFilter
    ? { ...fullTree, children: fullTree.children.filter(c => (featureGroup(c.filePath) ?? 'Other') === $flowFeatureFilter) }
    : fullTree;

  // Ghost layer: navigation-history strip + sibling chips. Keeps the user
  // oriented when they drill into a node — they can still see the chain
  // they clicked through and what other children were siblings at the
  // last step. `ancestorChain` is the full nav path (every trail entry
  // plus the current focus); siblings are other children of the immediate
  // previous root, in the forward adjacency for the active direction.
  $: ancestorChain = root !== null ? [...$flowTrail, root] : [];
  $: prevRoot = $flowTrail.length > 0 ? $flowTrail[$flowTrail.length - 1] : null;
  $: ghostSiblings = prevRoot !== null
    ? (adj.get(prevRoot) || []).map(([id]) => id).filter(id => id !== root)
    : [];
  $: hasGhostAncestors = ancestorChain.length > 1;
  $: hasGhostSiblings = ghostSiblings.length > 0;
  $: showGhosts = hasGhostAncestors || hasGhostSiblings;

  $: if (treeData && gEl && zoomBehavior) drawTree(treeData, $diffOverlayOn);

  // Renders the call-graph tree as SVG nodes/edges via D3, applying diff-overlay coloring when active.
  function drawTree(data, overlayOn) {
    const hierarchy = d3.hierarchy(data, d => d.children);
    const layoutFn = d3.tree().nodeSize([NODE_H + V_GAP, NODE_W + H_GAP]);
    layoutFn(hierarchy);

    const svg = d3.select(svgEl);
    svg.attr('viewBox', [0, 0, svgEl.clientWidth, svgEl.clientHeight]);
    const g = d3.select(gEl);
    g.selectAll('*').remove();

    // Arrow marker on every edge — direction is signalled at the path's end,
    // matching the tree's left→right parent→child orientation. Visual
    // direction is reinforced by the Sidebar/Header direction labels
    // (Calls → / Called by ←) so the user always knows which way they're
    // walking the graph. Rebuilt per draw because gEl's clear() doesn't
    // touch defs, and a stale marker would survive across redraws.
    const defs = svg.selectAll('defs').data([0]).join('defs');
    defs.selectAll('#flow-arrow').remove();
    defs.append('marker')
      .attr('id', 'flow-arrow')
      .attr('viewBox', '0 0 10 10')
      .attr('refX', 9).attr('refY', 5)
      .attr('markerWidth', 6).attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M 0 0 L 10 5 L 0 10 z')
      .attr('fill', 'var(--accent)');

    // For "called by" (in) the caller must render on the LEFT of the node
    // that calls it, so we mirror the horizontal axis — d3.tree always grows
    // children away from the root in +y, sx() flips that to -y for 'in'.
    const sign = curDir === 'in' ? -1 : 1;
    const sx = y => sign * y;

    const link = d3.linkHorizontal().x(d => sx(d.y)).y(d => d.x);
    // Shorten the path so the arrow tip lands just before the child node's
    // near edge instead of overlapping into the rect. d3.linkHorizontal ends
    // at target.y (child center) — pull it back (in tree space, pre-mirror)
    // by half the node width plus a small gap.
    const shorten = NODE_W / 2 + 4;

    g.append('g').selectAll('path').data(hierarchy.links()).join('path')
      .attr('fill', 'none').attr('stroke', 'var(--border)').attr('stroke-width', 1.5)
      .attr('marker-end', 'url(#flow-arrow)')
      .attr('d', d => link({ source: d.source, target: { ...d.target, y: d.target.y - shorten } }));

    const node = g.append('g').selectAll('g').data(hierarchy.descendants()).join('g')
      .attr('transform', d => `translate(${sx(d.y) - NODE_W / 2},${d.x - NODE_H / 2})`)
      .style('cursor', d => d.data.cyclic ? 'default' : 'pointer')
      .on('mouseenter', (event, d) => {
        tooltipState.set({ x: event.clientX, y: event.clientY, symId: d.data.id });
      })
      .on('mousemove', (event, d) => {
        tooltipState.update(cur => cur ? { ...cur, x: event.clientX, y: event.clientY } : cur);
      })
      .on('mouseleave', () => tooltipState.set(null));

    node.filter(d => !!d.data.doc).append('title').text(d => d.data.doc);

    node.append('rect').attr('width', NODE_W).attr('height', NODE_H).attr('rx', 8)
      .attr('fill', d => d.depth === 0 ? 'var(--accent-soft)' : 'var(--surface)')
      .attr('stroke', d => {
        if (overlayOn && changedSymIds.has(d.data.id)) return '#c94f7c';
        if (overlayOn && blastRadiusSymIds.has(d.data.id)) return '#c9a13f';
        return d.depth === 0 ? 'var(--accent)' : pkgColor(d.data.pkgIdx);
      })
      .attr('stroke-width', d => d.depth === 0 ? 2 : 1);

    node.append('text').attr('x', 12).attr('y', 18)
      .attr('font-family', "var(--vscode-editor-font-family, 'JetBrains Mono', monospace)").attr('font-size', 12).attr('font-weight', 700)
      .attr('fill', d => d.data.cyclic ? 'var(--muted)' : 'var(--text)')
      .text(d => d.data.cyclic ? `${d.data.name} (recursive)` : d.data.name)
      .each(function (d) { truncateText(this, NODE_W - 20); });

    node.append('text').attr('x', 12).attr('y', 33)
      .attr('font-family', "var(--vscode-font-family, 'Manrope', sans-serif)").attr('font-size', 10).attr('fill', 'var(--muted)')
      .text(d => `${d.data.kind} · ${displayName(d.data.filePath)}`)
      .each(function (d) { truncateText(this, NODE_W - 20); });

    node.filter(d => d.data.truncated || d.data.moreCount > 0)
      .append('text')
      .attr('x', curDir === 'in' ? 10 : NODE_W - 10).attr('y', NODE_H / 2 + 4)
      .attr('text-anchor', curDir === 'in' ? 'start' : 'end')
      .attr('font-family', "var(--vscode-editor-font-family, 'JetBrains Mono', monospace)").attr('font-size', 10).attr('font-weight', 700)
      .attr('fill', 'var(--accent)')
      .text(d => d.data.truncated ? (curDir === 'in' ? '← more' : 'more →') : `+${d.data.moreCount} more`);

    node.filter(d => !d.data.cyclic).on('click', (ev, d) => {
      ev.stopPropagation();
      if (d.depth > 0 || d.data.truncated) flowDrillTo(d.data.id);
    });

    renderGhosts();

    const w = svgEl.clientWidth, h = svgEl.clientHeight;
    const xs = hierarchy.descendants().map(d => d.x);
    const ys = hierarchy.descendants().map(d => sx(d.y));
    const treeWidth = (Math.max(...ys) - Math.min(...ys)) + NODE_W;
    const treeHeight = (Math.max(...xs) - Math.min(...xs)) + NODE_H;
    const padding = 40;
    // Reserve a top strip for the ghost trail so it doesn't sit on top of
    // the focused subtree. Tree center shifts down by half that margin.
    const topMargin = showGhosts ? 110 : 0;
    const availH = h - topMargin - padding * 2;
    const scale = Math.min(1, (w - padding * 2) / treeWidth, availH / treeHeight);
    const midY = (Math.max(...ys) + Math.min(...ys)) / 2;
    const midX = (Math.max(...xs) + Math.min(...xs)) / 2;
    const t = d3.zoomIdentity.translate(w / 2, h / 2 + topMargin / 2).scale(scale).translate(-midY, -midX);
    svg.call(zoomBehavior.transform, t);
  }

  // Ghost trail: dim navigation-history strip + sibling chips, rendered
  // into a separate <g> outside the zoom transform so it stays a fixed-size
  // reference regardless of how far the user has zoomed into the focus
  // subtree. Ancestors are the user's actual click chain — clicking one
  // jumps back to that ancestor via flowJumpToTrail (re-roots there, depth
  // resets, so they land on a clean view, not a half-filtered one).
  // Siblings are other children of the immediate previous root — a peek at
  // what was bypassed when the user clicked, capped to keep the strip
  // width manageable.
  const GHOST_SIB_CAP = 8;
  function renderGhosts() {
    const ghosts = d3.select(ghostsEl);
    ghosts.selectAll('*').remove();
    if (!showGhosts) return;

    const startX = 16;
    const yAncestors = 14;
    const ySiblings = yAncestors + NODE_H - 8 + 14;

    // Ancestor chain — drop the last entry (it's the focus, drawn as part
    // of the main tree, not the ghost strip).
    if (hasGhostAncestors) {
      const trailAncestors = ancestorChain.slice(0, -1);
      trailAncestors.forEach((id, i) => {
        const x = startX + i * (NODE_W + 14);
        const sym = DATA.symbols[id];
        const isLast = i === trailAncestors.length - 1;
        drawGhostNode(ghosts, x, yAncestors, sym[0], sym[1], () => flowJumpToTrail(i));
        if (!isLast) {
          ghosts.append('line')
            .attr('x1', x + NODE_W).attr('y1', yAncestors + (NODE_H - 8) / 2)
            .attr('x2', x + NODE_W + 14).attr('y2', yAncestors + (NODE_H - 8) / 2)
            .attr('stroke', 'var(--muted)').attr('stroke-dasharray', '2 3').attr('stroke-width', 1);
        } else {
          // Drop-line from last ancestor down toward the focus area — a
          // visual hint that the focused subtree below is "what comes
          // after" this ancestor in the click chain.
          ghosts.append('line')
            .attr('x1', x + NODE_W / 2).attr('y1', yAncestors + NODE_H - 8)
            .attr('x2', x + NODE_W / 2).attr('y2', yAncestors + NODE_H + 8)
            .attr('stroke', 'var(--accent)').attr('stroke-dasharray', '2 2').attr('stroke-width', 1.2);
        }
      });
    }

    if (hasGhostSiblings) {
      const visible = ghostSiblings.slice(0, GHOST_SIB_CAP);
      visible.forEach((id, i) => {
        const x = startX + i * (NODE_W + 14);
        const sym = DATA.symbols[id];
        drawGhostNode(ghosts, x, ySiblings, sym[0], sym[1], () => flowDrillTo(id));
      });
      if (ghostSiblings.length > GHOST_SIB_CAP) {
        const x = startX + GHOST_SIB_CAP * (NODE_W + 14);
        ghosts.append('text').attr('x', x).attr('y', ySiblings + 20)
          .attr('font-family', "var(--vscode-editor-font-family, 'JetBrains Mono', monospace)").attr('font-size', 11).attr('font-weight', 700)
          .attr('fill', 'var(--accent)')
          .text(`+${ghostSiblings.length - GHOST_SIB_CAP} more`);
      }
    }
  }

  // Draws one dashed "ghost" chip (ancestor or sibling) in the nav-history strip.
  function drawGhostNode(parent, x, y, name, kind, onClick) {
    const g = parent.append('g')
      .attr('class', 'ghost')
      .attr('transform', `translate(${x},${y})`)
      .style('cursor', 'pointer');
    g.append('rect')
      .attr('width', NODE_W).attr('height', NODE_H - 8).attr('rx', 6)
      .attr('fill', 'var(--surface)')
      .attr('stroke', 'var(--border)')
      .attr('stroke-dasharray', '3 3')
      .attr('stroke-width', 1);
    g.append('rect')
      .attr('x', 0).attr('y', 0).attr('width', 3).attr('height', NODE_H - 8).attr('rx', 1)
      .attr('fill', 'var(--muted)');
    g.append('text').attr('x', 10).attr('y', 14)
      .attr('font-family', "var(--vscode-editor-font-family, 'JetBrains Mono', monospace)").attr('font-size', 11).attr('font-weight', 600)
      .attr('fill', 'var(--muted)')
      .text(name)
      .each(function () { truncateText(this, NODE_W - 16); });
    g.append('text').attr('x', 10).attr('y', 28)
      .attr('font-family', "var(--vscode-font-family, 'Manrope', sans-serif)").attr('font-size', 9).attr('fill', 'var(--muted)')
      .text(kind);
    g.on('click', (ev) => { ev.stopPropagation(); onClick(); });
  }

  // Shrinks an SVG text node's content with an ellipsis until it fits within maxWidth.
  function truncateText(node, maxWidth) {
    let text = d3.select(node);
    let str = text.text();
    while (node.getComputedTextLength && node.getComputedTextLength() > maxWidth && str.length > 1) {
      str = str.slice(0, -1);
      text.text(str + '…');
    }
  }

  onMount(() => {
    const svg = d3.select(svgEl);
    const g = d3.select(gEl);
    zoomBehavior = d3.zoom().scaleExtent([0.25, 2.5]).on('zoom', (ev) => g.attr('transform', ev.transform));
    svg.call(zoomBehavior);
  });

  // Switching views (or navigating away) tears down these node <g> elements
  // without necessarily firing a DOM mouseleave on them first, which would
  // otherwise leave NodeTooltip (mounted globally in App.svelte) showing a
  // stale tooltip over whatever view comes next. Clear it unconditionally
  // on unmount.
  onDestroy(() => tooltipState.set(null));
</script>

<div class="flow-view">
  <div class="flow-rail">
    <div class="rail-head">
      <span class="section-title">Search files &amp; functions</span>
    </div>
    <div class="rail-body">
      <input type="text" placeholder="e.g. AddEditOutcomeModal or formatDate" autocomplete="off" bind:value={$searchQuery} />
      <div class="kind-chips">
        {#each availableKinds as k (k)}
          <button
            class="kind-chip"
            class:active={$symbolKindFilter && $symbolKindFilter.has(k)}
            data-tip="Toggle filter: show only symbols of kind '{k}'"
            on:click={() => toggleKind(k)}
          >{k}</button>
        {/each}
        {#if $symbolKindFilter}
          <button class="kind-chip clear" on:click={clearKindFilter} data-tip="Clear kind filter" aria-label="Clear kind filter">✕</button>
        {/if}
      </div>
      <div class="search-results">
        {#each symbolHits as symId (symId)}
          <div class="search-hit-row">
            <button class="search-hit" data-tip={DATA.symbols[symId][6] || null} on:click={() => openFlow(symId, 'out')}>
              <span class="mono" style="color:var(--accent); font-weight:700;">{DATA.symbols[symId][0]}</span>
              <span style="color:var(--muted);"> · {DATA.symbols[symId][1]} · {displayName(DATA.files[DATA.symbols[symId][4]][0])}</span>
              {#if DATA.symbols[symId][6]}<div class="hit-doc">{DATA.symbols[symId][6].split('\n')[0]}</div>{/if}
            </button>
            <button class="flow-btn" data-tip="Enumerate every path through this symbol (callers + callees)" on:click={() => openAllFlows(symId)}>all</button>
          </div>
        {/each}
      </div>
    </div>
  </div>

  <div class="flow-canvas">
    {#if root !== null}
      <div class="flow-toolbar">
        <ExportMenu {svgEl} filename={DATA.symbols[root][0]} />
        <button class="all-flows-btn" on:click={() => openAllFlows(root)} data-tip="Enumerate every path through this symbol (callers + callees)">
          all paths →
        </button>
      </div>
    {:else}
      <div class="flow-empty">
        <p>No symbol selected yet.</p>
        <p class="flow-empty-sub">Search a function on the left, or click any node in Packages/Files.</p>
      </div>
    {/if}

    <svg id="flow-svg" bind:this={svgEl}>
      <g bind:this={gEl}></g>
      <g bind:this={ghostsEl} class="ghost-layer"></g>
    </svg>
  </div>
</div>

<style>
  .flow-view {
    position: absolute;
    inset: 0;
    display: flex;
  }
  .flow-rail {
    width: 260px;
    flex: 0 0 auto;
    border-right: 1px solid var(--border);
    background: var(--surface);
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .rail-head {
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }
  .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
  .rail-body {
    flex: 1 1 auto;
    min-height: 0;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .flow-canvas {
    flex: 1 1 auto;
    min-width: 0;
    position: relative;
  }
  #flow-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .flow-toolbar {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .flow-empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 4px;
    color: var(--muted);
    pointer-events: none;
  }
  .flow-empty p { margin: 0; font-size: 13px; }
  .flow-empty-sub { max-width: 360px; }
  .all-flows-btn {
    background: var(--surface);
    color: var(--accent);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 5px 12px;
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .all-flows-btn:hover { border-color: var(--accent); background: var(--accent-soft); }
  .rail-body input {
    width: 100%;
    box-sizing: border-box;
  }
  .kind-chips {
    display: flex; flex-wrap: wrap; gap: 4px;
  }
  .kind-chip {
    background: var(--surface-2);
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 2px 8px;
    font-size: 10px;
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    cursor: pointer;
    flex-grow: 1;
  }
  .kind-chip:hover { color: var(--text); border-color: var(--accent); }
  .kind-chip.active { background: var(--accent); color: white; border-color: var(--accent); }
  .kind-chip.clear { color: var(--muted); }
  .search-results {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .search-hit-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .search-hit-row .search-hit { flex: 1; min-width: 0; }
  :global(.hit-doc) {
    font-size: 10.5px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 1px;
  }
  .flow-btn {
    flex: 0 0 auto;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--accent);
    background: var(--accent-soft);
    border: none;
    border-radius: 6px;
    padding: 4px 7px;
    cursor: pointer;
  }
  .flow-btn:hover { filter: brightness(1.1); }
  /* Ghost trail: dim navigation-history + sibling strip. Sits above the
     focused subtree so the user keeps spatial context for "where did I
     drill from". Hover bumps opacity so the click target stays legible. */
  .ghost-layer { pointer-events: all; }
  :global(.ghost) { opacity: 0.42; transition: opacity 0.12s ease; }
  :global(.ghost:hover) { opacity: 0.92; }
</style>