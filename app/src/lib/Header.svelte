<script>
  // Top app bar: title, back button, breadcrumb trail for the active view, and
  // global stats/actions (diff toggle, path finder).
  import { DATA, view, currentPkg, flowRoot, flowDirection, flowTrail, allFlowsRoot, pathFinderOpen } from './stores.js';
  import { goToPackagesView, flowJumpToTrail, openFlow } from './actions.js';
  import { goBack } from './hashState.js';
  import { shortPkg, displayName } from './graph.js';
  import DiffToggle from './DiffToggle.svelte';

  $: files = DATA.files;
  $: currentPackageFileCount = $view === 'files' ? files.reduce((n, f) => f[1] === $currentPkg ? n + 1 : n, 0) : 0;
  $: generatedLabel = DATA.generatedAt ? new Date(DATA.generatedAt).toLocaleString() : null;

  // Only show Back on views that the user navigated *into* — 'packages' is
  // the home view, so there's nothing meaningful to go back to.
  $: showBack = $view !== 'packages';

  // Long flow trails would overflow the header, so the middle of the trail
  // collapses into a "…" crumb (title tooltip lists what was hidden). Each
  // kept crumb remembers its original trail index so flowJumpToTrail still
  // works.
  const MAX_TRAIL_CRUMBS = 4;
  $: trailView = (() => {
    const trail = $flowTrail || [];
    if (trail.length <= MAX_TRAIL_CRUMBS + 1) {
      return { head: trail.map((symId, i) => ({ symId, i })), tail: [], hiddenNames: [] };
    }
    const keep = MAX_TRAIL_CRUMBS / 2;
    const head = trail.slice(0, keep).map((symId, i) => ({ symId, i }));
    const tailStart = trail.length - keep;
    const tail = trail.slice(tailStart).map((symId, i) => ({ symId, i: tailStart + i }));
    const hiddenNames = trail.slice(keep, tailStart).map(id => DATA.symbols[id][0]);
    return { head, tail, hiddenNames };
  })();
</script>

<header>
  <h1>CodeGraph <span>Explorer</span></h1>
  {#if showBack}
    <button class="back-btn" data-tip="Back (b · Alt+←)" on:click={goBack}>← Back</button>
  {/if}
  <div class="breadcrumb">
    <button class="crumb" class:current={$view === 'packages'} on:click={goToPackagesView}>Packages</button>
    {#if $view === 'files'}
      <span class="sep">/</span>
      <span class="crumb current">{shortPkg(DATA.packages[$currentPkg][0])}</span>
    {:else if $view === 'deadCode'}
      <span class="sep">/</span>
      <span class="crumb current">dead code</span>
    {:else if $view === 'hubs'}
      <span class="sep">/</span>
      <span class="crumb current">hubs</span>
    {:else if $view === 'entryPoints'}
      <span class="sep">/</span>
      <span class="crumb current">entry points</span>
    {:else if $view === 'pkgSummary'}
      <span class="sep">/</span>
      <span class="crumb current">pkg summary</span>
    {:else if $view === 'routes'}
      <span class="sep">/</span>
      <span class="crumb current">API surface</span>
    {:else if $view === 'structure'}
      <span class="sep">/</span>
      <span class="crumb current">structure</span>
    {:else if $view === 'docs'}
      <span class="sep">/</span>
      <span class="crumb current">docs coverage</span>
    {:else if $view === 'indexHealth'}
      <span class="sep">/</span>
      <span class="crumb current">index health</span>
    {:else if $view === 'domains'}
      <span class="sep">/</span>
      <span class="crumb current">domains</span>
    {:else if $view === 'allFlows' && $allFlowsRoot !== null}
      <span class="sep">/</span>
      <button class="crumb" on:click={() => openFlow($allFlowsRoot, 'out')}>flow</button>
      <span class="sep">/</span>
      <span class="crumb current">all paths: {DATA.symbols[$allFlowsRoot][0]}</span>
    {:else if $view === 'flow' && $flowRoot === null}
      <span class="sep">/</span>
      <span class="crumb current">flow</span>
    {:else if $view === 'flow' && $flowRoot !== null}
      <span class="sep">/</span>
      <span class="crumb">flow: {$flowDirection === 'out' ? '→ calls' : '← called by'}</span>
      {#each trailView.head as c (c.i)}
        <span class="sep">/</span>
        <button class="crumb" on:click={() => flowJumpToTrail(c.i)}>{DATA.symbols[c.symId][0]}</button>
      {/each}
      {#if trailView.tail.length}
        <span class="sep">/</span>
        <span class="crumb ellipsis" data-tip={trailView.hiddenNames.join(' / ')}>…</span>
        {#each trailView.tail as c (c.i)}
          <span class="sep">/</span>
          <button class="crumb" on:click={() => flowJumpToTrail(c.i)}>{DATA.symbols[c.symId][0]}</button>
        {/each}
      {/if}
      <span class="sep">/</span>
      <span class="crumb current">{DATA.symbols[$flowRoot][0]}</span>
    {/if}
  </div>
  <div class="spacer"></div>
  <DiffToggle />
  <button class="find-path-btn" data-tip="Find path between two symbols (p)" on:click={() => pathFinderOpen.set(true)}>⇄ Find path</button>
  <div class="stats">
    {#if $view === 'packages'}
      <span><b>{DATA.packages.length}</b> packages</span>
      <span><b>{DATA.files.length.toLocaleString()}</b> files</span>
      <span><b>{DATA.packageEdges.length}</b> cross-package links</span>
    {:else if $view === 'files'}
      <span><b>{currentPackageFileCount.toLocaleString()}</b> files</span>
    {:else if $flowRoot !== null}
      <span>in <b>{displayName(DATA.files[DATA.symbols[$flowRoot][4]][0])}</b></span>
    {/if}
    {#if generatedLabel}<span>generated {generatedLabel}</span>{/if}
  </div>
</header>

<style>
  .back-btn {
    flex-shrink: 0;
    background: var(--surface-2);
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 10px;
    font-family: var(--vscode-font-family, 'Manrope', sans-serif);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    margin-right: 12px;
    transition: color 0.1s ease, border-color 0.1s ease;
  }
  .back-btn:hover { color: var(--accent); border-color: var(--accent); }

  .find-path-btn {
    flex-shrink: 0;
    background: var(--surface-2);
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 10px;
    font-family: var(--vscode-font-family, 'Manrope', sans-serif);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    margin-right: 12px;
  }
  .find-path-btn:hover { color: var(--accent); border-color: var(--accent); }
</style>
