<script>
  import { onMount } from 'svelte';
  import * as d3 from 'd3';
  import { DATA, symOutAdj, symInAdj, flowRoot, flowDirection, flowDepth, flowFeatureFilter, packageFilter, flowTrail } from './stores.js';
  import { flowDrillTo, flowJumpToTrail, openAllFlows } from './actions.js';
  import { buildFlowTree, pkgColor, displayName, featureGroup } from './graph.js';

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

  $: if (treeData && gEl && zoomBehavior) drawTree(treeData);

  function drawTree(data) {
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
      .style('cursor', d => d.data.cyclic ? 'default' : 'pointer');

    node.filter(d => !!d.data.doc).append('title').text(d => d.data.doc);

    node.append('rect').attr('width', NODE_W).attr('height', NODE_H).attr('rx', 8)
      .attr('fill', d => d.depth === 0 ? 'var(--accent-soft)' : 'var(--surface)')
      .attr('stroke', d => d.depth === 0 ? 'var(--accent)' : pkgColor(d.data.pkgIdx))
      .attr('stroke-width', d => d.depth === 0 ? 2 : 1);

    node.append('text').attr('x', 12).attr('y', 18)
      .attr('font-family', "'JetBrains Mono', monospace").attr('font-size', 12).attr('font-weight', 700)
      .attr('fill', d => d.data.cyclic ? 'var(--muted)' : 'var(--text)')
      .text(d => d.data.cyclic ? `${d.data.name} (recursive)` : d.data.name)
      .each(function (d) { truncateText(this, NODE_W - 20); });

    node.append('text').attr('x', 12).attr('y', 33)
      .attr('font-family', "'Manrope', sans-serif").attr('font-size', 10).attr('fill', 'var(--muted)')
      .text(d => `${d.data.kind} · ${displayName(d.data.filePath)}`)
      .each(function (d) { truncateText(this, NODE_W - 20); });

    node.filter(d => d.data.truncated || d.data.moreCount > 0)
      .append('text')
      .attr('x', curDir === 'in' ? 10 : NODE_W - 10).attr('y', NODE_H / 2 + 4)
      .attr('text-anchor', curDir === 'in' ? 'start' : 'end')
      .attr('font-family', "'JetBrains Mono', monospace").attr('font-size', 10).attr('font-weight', 700)
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
          .attr('font-family', "'JetBrains Mono', monospace").attr('font-size', 11).attr('font-weight', 700)
          .attr('fill', 'var(--accent)')
          .text(`+${ghostSiblings.length - GHOST_SIB_CAP} more`);
      }
    }
  }

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
      .attr('font-family', "'JetBrains Mono', monospace").attr('font-size', 11).attr('font-weight', 600)
      .attr('fill', 'var(--muted)')
      .text(name)
      .each(function () { truncateText(this, NODE_W - 16); });
    g.append('text').attr('x', 10).attr('y', 28)
      .attr('font-family', "'Manrope', sans-serif").attr('font-size', 9).attr('fill', 'var(--muted)')
      .text(kind);
    g.on('click', (ev) => { ev.stopPropagation(); onClick(); });
  }

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
</script>

{#if root !== null}
  <button class="all-flows-btn" on:click={() => openAllFlows(root)} title="Enumerate every path through this symbol (callers + callees)">
    all paths →
  </button>
{/if}
<svg id="flow-svg" bind:this={svgEl}>
  <g bind:this={gEl}></g>
  <g bind:this={ghostsEl} class="ghost-layer"></g>
</svg>

<style>
  #flow-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .all-flows-btn {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 5;
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
  /* Ghost trail: dim navigation-history + sibling strip. Sits above the
     focused subtree so the user keeps spatial context for "where did I
     drill from". Hover bumps opacity so the click target stays legible. */
  .ghost-layer { pointer-events: all; }
  :global(.ghost) { opacity: 0.42; transition: opacity 0.12s ease; }
  :global(.ghost:hover) { opacity: 0.92; }
</style>