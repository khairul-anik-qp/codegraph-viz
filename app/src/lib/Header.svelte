<script>
  // Top app bar: title, back button, breadcrumb trail for the active view, and
  // global stats/actions (diff toggle, path finder).
  import { DATA, view, currentPkg, flowRoot, flowDirection, flowTrail, allFlowsRoot, pathFinderOpen, themeMode } from './stores.js';
  import { goToPackagesView, flowJumpToTrail, openFlow, toggleListView } from './actions.js';
  import { goBack } from './hashState.js';
  import { shortPkg, displayName } from './graph.js';
  import DiffToggle from './DiffToggle.svelte';

  $: files = DATA.files;
  $: currentPackageFileCount = $view === 'files' ? files.reduce((n, f) => f[1] === $currentPkg ? n + 1 : n, 0) : 0;
  $: generatedLabel = DATA.generatedAt ? new Date(DATA.generatedAt).toLocaleString() : null;

  // Stale files / unresolved imports — surfaced only as a banner when there's
  // actually something wrong, instead of a permanent always-zero nav row.
  $: staleFileCount = DATA.files.reduce((n, f) => n + (f[4] != null && f[5] != null && f[4] > f[5] ? 1 : 0), 0);
  $: unresolvedImportCount = (DATA.unresolvedImports || []).length;
  $: indexHealthIssues = staleFileCount + unresolvedImportCount;
  // Only show Back on views that the user navigated *into* — 'packages' is
  // the home view, so there's nothing meaningful to go back to.
  $: showBack = $view !== 'packages';

  const THEME_CYCLE = { system: 'light', light: 'dark', dark: 'system' };
  const THEME_ICON = { system: '🖥', light: '☀', dark: '🌙' };
  const THEME_LABEL = { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' };
  function cycleTheme() { themeMode.set(THEME_CYCLE[$themeMode]); }
</script>

<header>
  <h1>CodeGraph <span>Explorer</span></h1>
  {#if showBack}
    <button class="back-btn" title="Back (b · Alt+←)" on:click={goBack}>← Back</button>
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
    {:else if $view === 'allFlows' && $allFlowsRoot !== null}
      <span class="sep">/</span>
      <button class="crumb" on:click={() => openFlow($allFlowsRoot, 'out')}>flow</button>
      <span class="sep">/</span>
      <span class="crumb current">all paths: {DATA.symbols[$allFlowsRoot][0]}</span>
    {:else if $view === 'flow' && $flowRoot !== null}
      <span class="sep">/</span>
      <span class="crumb">flow: {$flowDirection === 'out' ? '→ calls' : '← called by'}</span>
      {#each $flowTrail as symId, i (i)}
        <span class="sep">/</span>
        <button class="crumb" on:click={() => flowJumpToTrail(i)}>{DATA.symbols[symId][0]}</button>
      {/each}
      <span class="sep">/</span>
      <span class="crumb current">{DATA.symbols[$flowRoot][0]}</span>
    {/if}
  </div>
  <div class="spacer"></div>
  {#if indexHealthIssues > 0}
    <button
      class="health-banner"
      title="Stale files and unresolved internal imports — is this export trustworthy?"
      on:click={() => toggleListView('indexHealth')}
    >
      ⚠ {indexHealthIssues} index issue{indexHealthIssues === 1 ? '' : 's'}
    </button>
  {/if}
  <DiffToggle />
  <button class="theme-btn" title="{THEME_LABEL[$themeMode]} (click to cycle)" on:click={cycleTheme}>{THEME_ICON[$themeMode]}</button>
  <button class="find-path-btn" title="Find path between two symbols (p)" on:click={() => pathFinderOpen.set(true)}>⇄ Find path</button>
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

  .health-banner {
    background: color-mix(in srgb, var(--danger) 16%, var(--surface));
    color: var(--danger);
    border: 1px solid var(--danger);
    border-radius: 6px;
    padding: 4px 10px;
    font-family: var(--vscode-font-family, 'Manrope', sans-serif);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    margin-right: 12px;
  }
  .health-banner:hover { background: color-mix(in srgb, var(--danger) 28%, var(--surface)); }

  .theme-btn {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 8px;
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
    margin-right: 12px;
  }
  .theme-btn:hover { border-color: var(--accent); }

  .find-path-btn {
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
