<script>
  // Force-directed bubble view of packages, sized by file count and colored by package, with click-to-isolate and double-click-to-drill-in navigation.
  import { onMount, onDestroy } from 'svelte';
  import * as d3 from 'd3';
  import { DATA, isolate, packageFilter } from './stores.js';
  import { setIsolate, clearIsolate, openPackage } from './actions.js';
  import { pkgColor, shortPkg } from './graph.js';

  let svgEl;
  let simulation;
  let nodeSel, linkSel;
  let unsubIsolate, unsubFilter;

  // Whether a package node should render dimmed given the current isolate/filter state.
  function isDimmed($isolate, $packageFilter, id) {
    if ($isolate && !$isolate.visible.has(id)) return true;
    if ($packageFilter && !$packageFilter.has(id)) return true;
    return false;
  }

  // Restyles existing nodes/links (opacity, color) to reflect the current isolate/filter state without rebuilding the simulation.
  function applyIsolateStyle($isolate, $packageFilter) {
    if (!nodeSel || !linkSel) return;
    linkSel
      .attr('stroke', d => {
        const s = d.source.id ?? d.source, t = d.target.id ?? d.target;
        if ($isolate) return ($isolate.visible.has(s) && $isolate.visible.has(t)) ? 'var(--muted)' : 'transparent';
        return (isDimmed(null, $packageFilter, s) || isDimmed(null, $packageFilter, t)) ? 'transparent' : 'var(--muted)';
      })
      .attr('stroke-opacity', $isolate ? 0.55 : 0.35);
    nodeSel.select('circle')
      .attr('fill-opacity', d => isDimmed($isolate, $packageFilter, d.id) ? 0.12 : ($isolate ? 0.9 : 0.85));
    nodeSel.selectAll('text')
      .attr('fill', function (d) {
        const isFileCount = this.getAttribute('data-role') === 'filecount';
        if (isDimmed($isolate, $packageFilter, d.id)) return 'var(--muted)';
        return isFileCount ? 'rgba(255,255,255,0.85)' : '#fff';
      });
  }

  onMount(() => {
    const svg = d3.select(svgEl);
    const main = svgEl.closest('main');
    const w = main.clientWidth, h = main.clientHeight;
    svg.attr('viewBox', [0, 0, w, h]);

    const nodes = DATA.packages.map((p, i) => ({
      id: i, name: p[0], fileCount: p[1], symbolCount: p[2],
      r: 26 + Math.sqrt(p[1]) * 3.2,
    }));
    const links = DATA.packageEdges.map(e => ({ source: e[0], target: e[1], iw: e[2], cw: e[3] }));

    const g = svg.append('g');
    svg.call(d3.zoom().scaleExtent([0.4, 3]).on('zoom', (ev) => g.attr('transform', ev.transform)));

    linkSel = g.append('g').selectAll('line')
      .data(links).join('line')
      .attr('stroke-width', d => Math.max(1, Math.log2((d.iw + d.cw) || 1)));

    nodeSel = g.append('g').selectAll('g')
      .data(nodes).join('g')
      .style('cursor', 'pointer')
      .call(d3.drag()
        .on('start', (ev, d) => { if (!ev.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
        .on('end', (ev, d) => { if (!ev.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }));

    nodeSel.append('circle')
      .attr('r', d => d.r)
      .attr('fill', d => pkgColor(d.id))
      .attr('stroke', 'var(--surface)')
      .attr('stroke-width', 2);

    nodeSel.append('text')
      .text(d => shortPkg(d.name))
      .attr('text-anchor', 'middle')
      .attr('dy', -2)
      .style('font-family', "var(--vscode-font-family, 'Manrope', sans-serif)")
      .style('font-weight', 800)
      .style('font-size', '12px')
      .style('pointer-events', 'none');
    nodeSel.append('text')
      .attr('data-role', 'filecount')
      .text(d => `${d.fileCount} files`)
      .attr('text-anchor', 'middle')
      .attr('dy', 13)
      .style('font-family', "var(--vscode-editor-font-family, 'JetBrains Mono', monospace)")
      .style('font-size', '10px')
      .style('pointer-events', 'none');

    // Track live values locally so click handlers (which run outside Svelte's
    // reactivity) can read current state, and restyle without rebuilding.
    let currentIsolate = null;
    let currentFilter = null;
    unsubIsolate = isolate.subscribe(v => { currentIsolate = v; applyIsolateStyle(currentIsolate, currentFilter); });
    unsubFilter = packageFilter.subscribe(v => { currentFilter = v; applyIsolateStyle(currentIsolate, currentFilter); });

    nodeSel.on('click', (ev, d) => {
      ev.stopPropagation();
      if (currentIsolate && currentIsolate.type === 'pkg' && currentIsolate.idx === d.id) {
        openPackage(d.id);
      } else {
        setIsolate('pkg', d.id, shortPkg(d.name));
      }
    });
    nodeSel.on('dblclick', (ev, d) => { ev.stopPropagation(); openPackage(d.id); });

    svg.on('click', () => { if (currentIsolate) clearIsolate(); });

    simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(d => d.id).distance(140).strength(0.25))
      .force('charge', d3.forceManyBody().strength(-900))
      .force('center', d3.forceCenter(w / 2, h / 2))
      .force('collide', d3.forceCollide().radius(d => d.r + 14))
      .on('tick', () => {
        linkSel.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
        nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
      });
  });

  onDestroy(() => {
    if (simulation) simulation.stop();
    if (unsubIsolate) unsubIsolate();
    if (unsubFilter) unsubFilter();
  });
</script>

<svg id="stage-svg" bind:this={svgEl}></svg>
