<script>
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import {
    view, currentPkg, flowRoot, allFlowsRoot, selectedSymbol, searchQuery,
    packageFilter, symbolKindFilter, pathFinderOpen, shortcutsHelpOpen,
  } from './lib/stores.js';
  import { openFlow, openAllFlows, jumpToSymbol, goToPackagesView, openPackage } from './lib/actions.js';
  import { goBack } from './lib/hashState.js';
  import Header from './lib/Header.svelte';
  import Sidebar from './lib/Sidebar.svelte';
  import PackageView from './lib/PackageView.svelte';
  import FileList from './lib/FileList.svelte';
  import FlowView from './lib/FlowView.svelte';
  import AllFlowsView from './lib/AllFlowsView.svelte';
  import DeadCodeView from './lib/DeadCodeView.svelte';
  import HubView from './lib/HubView.svelte';
  import EntryPointsView from './lib/EntryPointsView.svelte';
  import PkgSummaryView from './lib/PkgSummaryView.svelte';
  import RoutesView from './lib/RoutesView.svelte';
  import StructureView from './lib/StructureView.svelte';
  import DocsView from './lib/DocsView.svelte';
  import IndexHealthView from './lib/IndexHealthView.svelte';
  import DetailPanel from './lib/DetailPanel.svelte';
  import NodeTooltip from './lib/NodeTooltip.svelte';
  import PathFinderModal from './lib/PathFinderModal.svelte';
  import KeyboardShortcutsHelp from './lib/KeyboardShortcutsHelp.svelte';
  import { applyHashState, syncHash } from './lib/hashState.js';

  $: hint = $view === 'packages'
    ? 'Click a bubble to open a package. Click again to <b>isolate</b> its dependency chain.'
    : $view === 'files'
    ? 'Click a row to inspect a file in the panel &middot; click again to clear &middot; use search above to filter.'
    : $view === 'allFlows'
    ? 'Every path that flows through the searched symbol &middot; click any chip to jump to that function.'
    : $view === 'deadCode'
    ? 'Symbols with zero callers &middot; click any row to jump to that symbol &middot; sort by severity to find the easiest deletions.'
    : $view === 'hubs'
    ? 'Top-N most-called functions in the call graph &middot; click a row to drill into the flow.'
    : $view === 'entryPoints'
    ? 'Exported symbols with no internal callers + framework entry markers (HTTP, CLI, lifecycle).'
    : $view === 'pkgSummary'
    ? 'Per-package aggregate: files, symbols, dominant languages, top hubs by transitive reach.'
    : $view === 'routes'
    ? 'Every REST/GraphQL/WebSocket route, grouped by controller &middot; click a row to jump, "all →" to trace what it touches downstream.'
    : $view === 'structure'
    ? 'Class inheritance (extends/implements) and object construction (new X()) &mdash; relationships the call graph alone can\'t show.'
    : $view === 'docs'
    ? 'Exported-symbol docstring coverage per package, worst first &middot; expand a package to see what\'s undocumented.'
    : $view === 'indexHealth'
    ? 'Whether this export can be trusted right now &mdash; stale files and imports that never resolved.'
    : 'Click a node to make it the new root &middot; scroll to zoom &middot; drag to pan.';

  function isTypingTarget(t) {
    if (!t) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable;
  }

  onMount(() => {
    applyHashState();
    const cleanup = [];

    const handler = (ev) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

      const key = ev.key;
      const symId = get(selectedSymbol);

      // Escape always works — even when focused in a search input, blur it
      // first (so subsequent keystrokes route through this handler, not the
      // input). Other shortcuts are skipped while typing so the user can
      // search "fa" without it navigating away.
      if (key === 'Escape') {
        const active = document.activeElement;
        if (active && isTypingTarget(active)) { active.blur(); return; }
        if (get(shortcutsHelpOpen)) { shortcutsHelpOpen.set(false); return; }
        if (get(pathFinderOpen)) { pathFinderOpen.set(false); return; }
        if (get(searchQuery)) { searchQuery.set(''); return; }
        if (symId !== null) { selectedSymbol.set(null); return; }
        view.set('packages');
        return;
      }
      if (isTypingTarget(ev.target)) return;

      if (key === '/') {
        ev.preventDefault();
        const searchInput = document.querySelector('input[placeholder*="AddEditOutcomeModal"], input[placeholder*="Filter"]');
        if (searchInput) { searchInput.focus(); searchInput.select(); }
        return;
      }
      if (key === 'p') {
        ev.preventDefault();
        pathFinderOpen.set(true);
        return;
      }
      if (key === '?') {
        ev.preventDefault();
        shortcutsHelpOpen.set(true);
        return;
      }
      if (key === 'e' && get(view) === 'flow') {
        ev.preventDefault();
        window.dispatchEvent(new CustomEvent('codegraph:export-flow'));
        return;
      }
      if (symId === null) return;

      if (key === 'f') { openFlow(symId, 'out'); return; }
      if (key === 'a') { openAllFlows(symId); return; }
    };

    // 'b' for back — separate listener so it works even with no symbol
    // selected. Keep outside the main handler's `if (symId === null) return;`
    // guard. 'b' is the same key Alt+← maps to in browsers, by convention.
    const backHandler = (ev) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (isTypingTarget(ev.target)) return;
      if (ev.key === 'b' && get(view) !== 'packages') {
        ev.preventDefault();
        goBack();
      }
    };
    document.addEventListener('keydown', backHandler);
    cleanup.push(() => document.removeEventListener('keydown', backHandler));

    document.addEventListener('keydown', handler);
    cleanup.push(() => document.removeEventListener('keydown', handler));

    return () => cleanup.forEach(fn => fn());
  });
</script>

<Header />
<div class="body-row">
  <Sidebar />
  <main>
    {#if $view === 'packages'}
      <PackageView />
    {:else if $view === 'files'}
      {#key $currentPkg}
        <FileList pkgIdx={$currentPkg} />
      {/key}
    {:else if $view === 'allFlows'}
      <AllFlowsView />
    {:else if $view === 'deadCode'}
      <DeadCodeView />
    {:else if $view === 'hubs'}
      <HubView />
    {:else if $view === 'entryPoints'}
      <EntryPointsView />
    {:else if $view === 'pkgSummary'}
      <PkgSummaryView />
    {:else if $view === 'routes'}
      <RoutesView />
    {:else if $view === 'structure'}
      <StructureView />
    {:else if $view === 'docs'}
      <DocsView />
    {:else if $view === 'indexHealth'}
      <IndexHealthView />
    {:else}
      <FlowView />
    {/if}
    <div class="hint">{@html hint}</div>
  </main>
  <DetailPanel />
  <NodeTooltip />
  <PathFinderModal />
  <KeyboardShortcutsHelp />
</div>
