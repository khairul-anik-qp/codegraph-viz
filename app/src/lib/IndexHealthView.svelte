<script>
  import { DATA } from './stores.js';
  import { jumpToFile } from './actions.js';
  import { displayName } from './graph.js';

  $: projectRoot = DATA.projectRoot || '';
  function vscodeUri(relPath, line = 1, col = 1) {
    if (!projectRoot) return '#';
    return `vscode://file${projectRoot}/${relPath}:${line}:${col}`;
  }

  // A file is stale when its source changed after CodeGraph last indexed
  // it — everything the viewer says about that file's call graph could be
  // wrong until a reindex. files[i] = [path, pkgIdx, language, nodeCount,
  // modifiedAt, indexedAt] (epoch ms); older exports won't carry the last
  // two fields, so guard for undefined rather than treating them as 0.
  $: staleFiles = (() => {
    const out = [];
    for (let i = 0; i < DATA.files.length; i++) {
      const f = DATA.files[i];
      const modifiedAt = f[4], indexedAt = f[5];
      if (modifiedAt == null || indexedAt == null) continue;
      if (modifiedAt > indexedAt) out.push({ idx: i, path: f[0], ageMs: modifiedAt - indexedAt });
    }
    return out.sort((a, b) => b.ageMs - a.ageMs);
  })();

  // unresolvedImports = [fileIdx, importedName, line][] — see graph.js's
  // DATA-shape doc for why this is already filtered down to internal-looking
  // (relative or `@/`-alias) specifiers before it ever reaches the viewer.
  $: brokenByFile = (() => {
    const groups = new Map();
    for (const [fileIdx, name, line] of (DATA.unresolvedImports || [])) {
      if (!groups.has(fileIdx)) groups.set(fileIdx, []);
      groups.get(fileIdx).push({ name, line });
    }
    return [...groups.entries()]
      .map(([fileIdx, refs]) => ({ fileIdx, path: DATA.files[fileIdx][0], refs: refs.sort((a, b) => a.line - b.line) }))
      .sort((a, b) => b.refs.length - a.refs.length);
  })();

  $: totalBroken = brokenByFile.reduce((n, g) => n + g.refs.length, 0);

  // files[i][6] = errors CodeGraph's own indexer recorded for that file
  // (parse errors it couldn't fully recover from) — [] when clean, absent
  // (undefined) in older exports.
  $: erroredFiles = (() => {
    const out = [];
    for (let i = 0; i < DATA.files.length; i++) {
      const errs = DATA.files[i][6];
      if (errs && errs.length) out.push({ idx: i, path: DATA.files[i][0], errors: errs });
    }
    return out.sort((a, b) => b.errors.length - a.errors.length);
  })();
  $: totalErrors = erroredFiles.reduce((n, f) => n + f.errors.length, 0);

  // Free-form key/value bag CodeGraph's indexer writes about its own run —
  // shown as-is rather than modeled field-by-field since the key set is
  // CodeGraph's to evolve.
  $: metadataEntries = Object.entries(DATA.projectMetadata || {});

  function formatAge(ms) {
    const days = ms / 86400000;
    if (days < 1) return '< 1 day';
    if (days < 2) return '1 day';
    return `${Math.round(days)} days`;
  }
</script>

<div class="health">
  <div class="head">
    <h1>Index health</h1>
    <p class="sub">Whether this export can be trusted right now: files that changed since the last index build, and imports that never resolved to anything in the repo.</p>
    {#if metadataEntries.length > 0}
      <div class="meta-strip">
        {#each metadataEntries as [k, v] (k)}
          <span class="meta-item"><span class="meta-key">{k}</span><span class="meta-val mono">{v}</span></span>
        {/each}
      </div>
    {/if}
  </div>

  <div class="rows">
    <section>
      <div class="section-head">
        <h2>Files with index errors</h2>
        <span class="count" class:zero={totalErrors === 0}>{totalErrors}</span>
      </div>
      {#if totalErrors === 0}
        <div class="ok">None — CodeGraph indexed every file without recording an error.</div>
      {:else}
        <p class="section-note">CodeGraph's own parser/extractor recorded these while indexing — usually a syntax error it couldn't fully recover from, so that file's symbols/edges may be incomplete.</p>
        {#each erroredFiles as f (f.idx)}
          <div class="broken-group">
            <button class="broken-file" on:click={() => jumpToFile(f.idx)}>
              <span class="mono path" title={f.path}>{displayName(f.path)}</span>
              <span class="count-pill">{f.errors.length}</span>
            </button>
            {#each f.errors as e}
              <div class="broken-ref mono" style="padding-left:20px;">{typeof e === 'string' ? e : (e.message || JSON.stringify(e))}</div>
            {/each}
          </div>
        {/each}
      {/if}
    </section>

    <section>
      <div class="section-head">
        <h2>Stale files</h2>
        <span class="count" class:zero={staleFiles.length === 0}>{staleFiles.length}</span>
      </div>
      {#if staleFiles.length === 0}
        <div class="ok">None — every indexed file's source is unchanged since it was last indexed.</div>
      {:else}
        <p class="section-note">Source changed after CodeGraph last saw it. Everything the viewer says about these files' calls/callers may be out of date until <span class="mono">codegraph index</span> reruns.</p>
        {#each staleFiles as f (f.idx)}
          <button class="row" on:click={() => jumpToFile(f.idx)}>
            <span class="mono path" title={f.path}>{f.path}</span>
            <span class="age">stale {formatAge(f.ageMs)}</span>
          </button>
        {/each}
      {/if}
    </section>

    <section>
      <div class="section-head">
        <h2>Unresolved internal imports</h2>
        <span class="count" class:zero={totalBroken === 0}>{totalBroken}</span>
      </div>
      {#if totalBroken === 0}
        <div class="ok">None — every relative/alias import resolved to a real file.</div>
      {:else}
        <p class="section-note">Import specifiers that look internal (relative, or a <span class="mono">@/</span>-style alias) but never resolved — either a genuinely broken import or a path alias CodeGraph doesn't understand. External packages and non-import references are excluded; they dominate the raw index and aren't actionable here.</p>
        {#each brokenByFile as g (g.fileIdx)}
          <div class="broken-group">
            <button class="broken-file" on:click={() => jumpToFile(g.fileIdx)}>
              <span class="mono path" title={g.path}>{displayName(g.path)}</span>
              <span class="count-pill">{g.refs.length}</span>
            </button>
            {#each g.refs as r (r.line + r.name)}
              <a class="broken-ref mono" href={vscodeUri(g.path, r.line)} title={projectRoot ? 'Open in VS Code' : 'No project root — links disabled'}>
                <span class="ln">:{r.line}</span>
                <span class="ref-name">{r.name}</span>
              </a>
            {/each}
          </div>
        {/each}
      {/if}
    </section>
  </div>
</div>

<style>
  .health {
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    font-family: var(--vscode-font-family, 'Manrope', sans-serif);
    color: var(--text);
  }
  .head {
    padding: 14px 18px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .head h1 { margin: 0; font-size: 18px; }
  .head .sub { margin: 4px 0 0 0; color: var(--muted); font-size: 12px; line-height: 1.4; max-width: 680px; }
  .meta-strip { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 10px; }
  .meta-item { display: flex; align-items: baseline; gap: 5px; font-size: 11px; }
  .meta-key { color: var(--muted); }
  .meta-val { color: var(--text); font-size: 11px; }

  .rows { overflow-y: auto; flex: 1; padding: 14px 18px 30px; }
  section { margin-bottom: 26px; }
  .section-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
  .section-head h2 { margin: 0; font-size: 14px; }
  .section-head .count {
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    font-size: 12px; font-weight: 700;
    color: #c94f7c;
    background: rgba(201, 79, 124, 0.12);
    border-radius: 10px;
    padding: 1px 8px;
  }
  .section-head .count.zero { color: #3fa77f; background: rgba(63, 167, 127, 0.12); }
  .section-note { margin: 0 0 10px 0; color: var(--muted); font-size: 12px; line-height: 1.5; max-width: 680px; }
  .ok { color: var(--muted); font-size: 12.5px; padding: 6px 0; }

  .row {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    width: 100%;
    background: var(--surface); border: 1px solid var(--border); border-radius: 6px;
    padding: 7px 12px; margin-bottom: 4px;
    cursor: pointer; text-align: left; font-size: 12px;
    color: var(--text);
  }
  .row:hover { background: var(--accent-soft); }
  .row .path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .age { color: var(--muted); font-size: 11px; flex: 0 0 auto; }

  .broken-group { margin-bottom: 8px; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
  .broken-file {
    display: flex; align-items: center; gap: 8px;
    width: 100%;
    background: var(--surface-2); border: none;
    padding: 6px 12px;
    cursor: pointer; text-align: left; font-size: 12.5px; font-weight: 700;
    color: var(--text);
  }
  .broken-file:hover { background: var(--accent-soft); }
  .count-pill {
    margin-left: auto;
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); font-size: 10.5px; font-weight: 700;
    color: var(--muted);
  }
  .broken-ref {
    display: flex; align-items: baseline; gap: 8px;
    padding: 4px 12px 4px 20px;
    font-size: 11.5px;
    text-decoration: none;
    color: var(--text);
    border-top: 1px solid var(--border);
  }
  .broken-ref:hover { background: var(--accent-soft); color: var(--accent); }
  .broken-ref .ln { color: var(--muted); flex: 0 0 auto; }
</style>
