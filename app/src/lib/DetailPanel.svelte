<script>
  // Right-hand detail panel: shows the selected file's symbol overview, or a
  // selected symbol's full signature, docs, source snippet, callers/callees.
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import { DATA, selectedFile, selectedSymbol, fileInAdj, fileOutAdj, symInAdj, symOutAdj, symUsageInAdj, detailMode, sourceModalOpen } from './stores.js';
  import { jumpToFile, jumpToSymbol, selectSymbol, backToFileOverview, openFlow } from './actions.js';
  import { pkgColor, shortPkg, displayName, complexity, findRelatedTests, transitiveReach, parseSignature, parseTypeBody } from './graph.js';
  import { highlightLine } from './highlight.js';
  import SourceModal from './SourceModal.svelte';

  const KIND_GROUP_ORDER = ['component', 'class', 'function', 'method', 'interface', 'type_alias', 'enum', 'enum_member', 'constant', 'variable', 'property', 'route'];

  $: file = $selectedFile !== null ? DATA.files[$selectedFile] : null;
  $: symIds = $selectedFile !== null ? (DATA.fileSymbolIds[$selectedFile] || []) : [];
  $: symGroups = (() => {
    const byKind = new Map();
    for (const id of symIds) {
      const s = DATA.symbols[id];
      if (!byKind.has(s[1])) byKind.set(s[1], []);
      byKind.get(s[1]).push(id);
    }
    const order = [...KIND_GROUP_ORDER, ...[...byKind.keys()].filter(k => !KIND_GROUP_ORDER.includes(k))];
    return order.filter(k => byKind.has(k)).map(k => ({
      kind: k,
      items: byKind.get(k).slice().sort((a, b) => DATA.symbols[a][2] - DATA.symbols[b][2]).slice(0, 60),
      total: byKind.get(k).length,
    }));
  })();
  $: fileCallers = $selectedFile !== null
    ? (fileInAdj.get($selectedFile) || []).slice().sort((a, b) => b[2] - a[2]).slice(0, 8)
    : [];
  $: fileCallees = $selectedFile !== null
    ? (fileOutAdj.get($selectedFile) || []).slice().sort((a, b) => b[2] - a[2]).slice(0, 8)
    : [];

  // ---------- symbol focus ----------
  $: symbol = $selectedSymbol !== null ? DATA.symbols[$selectedSymbol] : null;
  $: symbolFile = symbol ? DATA.files[symbol[4]] : null;
  $: symCallers = $selectedSymbol !== null
    ? (symInAdj.get($selectedSymbol) || []).slice().sort((a, b) => b[1] - a[1])
    : [];
  $: symCallees = $selectedSymbol !== null
    ? (symOutAdj.get($selectedSymbol) || []).slice().sort((a, b) => b[1] - a[1])
    : [];
  $: symComplexity = symbol ? complexity(symbol[5]) : 0;
  $: symReach = $selectedSymbol !== null ? transitiveReach($selectedSymbol, symInAdj) : 0;
  $: isDead = $selectedSymbol !== null
    && symCallers.length === 0
    && (symUsageInAdj.get($selectedSymbol) || []).length === 0;
  // Walk inbound call edges, restricted to test-file symbols. Returns up
  // to 8 test symbols whose call chains reach this one.
  $: relatedTests = $selectedSymbol !== null
    ? findRelatedTests($selectedSymbol, symInAdj, DATA.files, DATA.symbols).slice(0, 8)
    : [];

  // TS-aware signature + type body parsed from the snippet. Truth comes
  // from the source — docstrings are description prose only, types live
  // in the signature. Both null when the snippet doesn't look parseable,
  // in which case the panel falls back to showing the raw first line.
  $: sig = symbol ? parseSignature(symbol[5]) : null;
  $: typeBody = symbol && (symbol[1] === 'interface' || symbol[1] === 'type_alias') ? parseTypeBody(symbol[5]) : null;
  $: isCallable = symbol && ['function', 'method', 'component', 'class', 'route'].includes(symbol[1]) && sig && sig.params.length > 0;
  $: docHtml = symbol && symbol[6] ? DOMPurify.sanitize(marked.parse(symbol[6], { breaks: true, gfm: true })) : '';

  // CodeGraph's own parsed fields (symbol[7..15]) — authoritative where the
  // heuristic snippet-regex parse above (`sig`) can't be: real return type
  // resolution, visibility, and static/async/abstract flags straight from
  // the language's own AST, not a best-effort regex over the first line.
  $: realSignature = symbol ? symbol[7] : '';
  $: realReturnType = symbol ? symbol[8] : '';
  $: visibility = symbol ? symbol[9] : '';
  $: isAsync = symbol ? (!!symbol[10] || (sig && sig.isAsync)) : false;
  $: isStatic = symbol ? !!symbol[11] : false;
  $: qualifiedName = symbol ? symbol[12] : '';
  $: isAbstract = symbol ? !!symbol[13] : false;
  $: decorators = symbol ? (symbol[14] || []) : [];
  $: typeParameters = symbol ? (symbol[15] || []) : [];

  // VS Code deep links — `vscode://file/<abs>:<line>:<col>` opens the file in
  // VS Code's currently-active window at the given position. projectRoot
  // comes from __GRAPH_DATA__ (set by codegraph-viz to the cwd it was run
  // in); when missing (e.g. dev mode without real data, or hosted on a
  // remote server), we degrade to a pathless href that the browser won't
  // resolve — the user just won't get a working link.
  $: projectRoot = DATA.projectRoot || '';
  function vscodeUri(relPath, line = 1, col = 1) {
    if (!projectRoot) return '#';
    // Some editors prefer file:// for cross-platform safety; vscode:// is
    // also valid. Both are handled by VS Code. We use vscode:// so the
    // browser respects it as an external protocol handler.
    const abs = `${projectRoot}/${relPath}`;
    return `vscode://file${abs}:${line}:${col}`;
  }
  // Snippet as a list of lines + the line number each one corresponds to
  // in the original file (snippet may start mid-file, so we offset by the
  // symbol's start line). The last "… (N more lines)" line, if any, is
  // detected and rendered without a line number / link — it's a truncation
  // marker, not real code.
  $: snippetLines = symbol ? (symbol[5] || '').split('\n') : [];
  $: snippetStart = symbol ? symbol[2] : 1;
  $: lastSnippetLine = snippetLines[snippetLines.length - 1] || '';
  $: snippetTruncated = lastSnippetLine.startsWith('…');
  // sourceModalOpen lives in stores.js (not a local let) so App.svelte's
  // global keydown handler can prioritize closing it on Escape and suppress
  // other shortcuts while it's open.
  $: if (symbol) sourceModalOpen.set(false);

  // Clears the selected file/symbol, closing the detail panel.
  function close() { selectedFile.set(null); selectedSymbol.set(null); }
</script>

<div id="detail-panel" class:open={!!file || !!symbol}>
  {#if symbol}
    <button class="close-btn" on:click={close}>✕</button>
    <button class="rel-row" style="padding:0; margin-bottom:10px; color:var(--muted);" on:click={backToFileOverview}>&larr; back to {displayName(symbolFile[0])}</button>
    <h2 class="mono">
      {symbol[0]}
      {#if isDead}
        <span class="dead-pill" data-tip="No callers and no references/extends/implements/instantiates found — likely dead code">⚠ dead</span>
      {/if}
    </h2>
    {#if qualifiedName && $detailMode === 'deepdive'}
      <div class="qualified-name mono" data-tip="Fully qualified name">{qualifiedName}</div>
    {/if}
    <div class="path-pkg">
      {symbol[1]} &middot;
      <span class="pkg-badge" style="color:{pkgColor(symbolFile[1])}" data-tip="Package">{shortPkg(DATA.packages[symbolFile[1]][0])}</span>
      &middot;
      <a class="path-link" href={vscodeUri(symbolFile[0], symbol[2])} data-tip={projectRoot ? 'Open in VS Code' : 'No project root — links disabled'}>
        {symbolFile[0]}:{symbol[2]}
      </a>
      {#if projectRoot}
        <a class="open-ide" href={vscodeUri(symbolFile[0], symbol[2])} data-tip="Open in VS Code" aria-label="Open in VS Code">↗</a>
      {/if}
    </div>

    {#if decorators.length > 0 && $detailMode === 'deepdive'}
      <div class="decorator-row mono">
        {#each decorators as d}<span class="decorator-chip">@{d}</span>{/each}
      </div>
    {/if}

    {#if $detailMode === 'deepdive' && (visibility || isAsync || isStatic || isAbstract || realReturnType || typeParameters.length > 0)}
      <div class="flag-row">
        {#if visibility}<span class="flag-badge mono">{visibility}</span>{/if}
        {#if isStatic}<span class="flag-badge mono">static</span>{/if}
        {#if isAsync}<span class="flag-badge mono">async</span>{/if}
        {#if isAbstract}<span class="flag-badge mono">abstract</span>{/if}
        {#if typeParameters.length > 0}<span class="flag-badge mono" data-tip="Type parameters">&lt;{typeParameters.join(', ')}&gt;</span>{/if}
        {#if realReturnType}<span class="flag-badge mono returns" data-tip="Return type">→ {realReturnType}</span>{/if}
      </div>
    {/if}
    {#if $detailMode === 'deepdive' && realSignature && realSignature !== symbol[0]}
      <div class="real-sig mono" data-tip="Signature as parsed by CodeGraph">{realSignature}</div>
    {/if}

    {#if symbol[6]}
      <div class="doc markdown">{@html docHtml}</div>
    {/if}

    {#if typeBody && typeBody.members.length > 0}
      <div class="sig-block">
        <div class="panel-title">{symbol[1] === 'interface' ? 'Fields' : 'Members'} ({typeBody.members.length})</div>
        <table class="param-table">
          <thead><tr><th>Name</th><th>Type</th></tr></thead>
          <tbody>
            {#each typeBody.members as m}
              <tr>
                <td class="mono name">{m.name}{m.optional ? '?' : ''}</td>
                <td class="mono type">{m.type}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if typeBody.generics}
          <div class="generics mono">&lt;{typeBody.generics}&gt;</div>
        {/if}
      </div>
    {/if}

    {#if isCallable}
      <div class="sig-block">
        <div class="panel-title">Parameters ({sig.params.length})</div>
        <table class="param-table">
          <thead><tr><th>Name</th><th>Type</th><th>Default</th></tr></thead>
          <tbody>
            {#each sig.params as p}
              <tr>
                <td class="mono name">{p.isRest ? '...' : ''}{p.name}{p.optional ? '?' : ''}</td>
                <td class="mono type">{p.type ?? '—'}</td>
                <td class="mono muted">{p.default ?? ''}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if sig.generics}
          <div class="generics mono">&lt;{sig.generics}&gt;</div>
        {/if}
        {#if sig.returns}
          <div class="returns">
            <span class="muted">→</span><span class="mono">{sig.returns}</span>
          </div>
        {/if}
        {#if sig.isAsync}
          <div class="badge mono">async</div>
        {/if}
      </div>
    {:else if sig && sig.returns && !isCallable}
      <div class="sig-block">
        <div class="returns"><span class="muted">→</span><span class="mono">{sig.returns}</span></div>
      </div>
    {/if}

    <div class="kv-grid" style="margin-bottom:14px;">
      <div class="k">Complexity</div>
      <div class="v" data-tip="Heuristic cyclomatic complexity (counts if/for/while/case/catch/&&/||/?)">
        <span class="complexity-pill" class:complex-high={symComplexity > 15} class:complex-med={symComplexity > 8 && symComplexity <= 15}>
          {symComplexity}
        </span>
        <span style="color:var(--muted); font-size:10.5px; margin-left:6px;">{symComplexity > 15 ? 'high' : symComplexity > 8 ? 'med' : symComplexity > 2 ? 'low' : 'trivial'}</span>
      </div>
      <div class="k">Transitive reach</div>
      <div class="v" data-tip="Total symbols that can reach this one through any call path">
        <b>{symReach}</b>
        <span style="color:var(--muted); font-size:10.5px; margin-left:6px;">symbols depend on this</span>
      </div>
    </div>

    {#if symbol[5]}
      <div class="panel-title-row">
        <div class="panel-title" style="margin:0;">Source</div>
        <button class="flow-link" on:click={() => sourceModalOpen.set(true)}>expand →</button>
      </div>
      <div class="snippet mono">
        {#each snippetLines as line, i}
          {#if i === snippetLines.length - 1 && snippetTruncated}
            <div class="snippet-line truncated"><span class="trunc">{line}</span></div>
          {:else}
            <div class="snippet-line">
              <a class="ln" href={vscodeUri(symbolFile[0], snippetStart + i)} data-tip={projectRoot ? `Open line ${snippetStart + i} in VS Code` : 'No project root'}>{snippetStart + i}</a>
              <span class="code">{@html highlightLine(line || ' ', symbolFile[2])}</span>
            </div>
          {/if}
        {/each}
      </div>
      <SourceModal
        open={$sourceModalOpen}
        name={symbol[0]}
        snippet={symbol[5]}
        language={symbolFile[2]}
        filePath={symbolFile[0]}
        startLine={snippetStart}
        on:close={() => sourceModalOpen.set(false)}
      />
    {/if}

    <div class="panel-title-row" style="margin-top:14px;">
      <div class="panel-title" style="margin:0;">Called by ({symCallers.length})</div>
      {#if symCallers.length > 0}
        <button class="flow-link" on:click={() => openFlow($selectedSymbol, 'in')}>view as flow →</button>
      {/if}
    </div>
    {#if symCallers.length === 0}
      <div class="empty-hint">No callers found in this codebase.</div>
    {/if}
    {#each symCallers as [id, w] (id)}
      <button class="rel-row" on:click={() => jumpToSymbol(id)}>
        <span class="rel-dot" style="background:var(--calls)"></span>
        <span class="nm">{DATA.symbols[id][0]} <span style="color:var(--muted)">· {displayName(DATA.files[DATA.symbols[id][4]][0])}</span></span>
        <span class="w">{w}</span>
      </button>
    {/each}

    <div class="panel-title-row" style="margin-top:12px;">
      <div class="panel-title" style="margin:0;">Calls ({symCallees.length})</div>
      {#if symCallees.length > 0}
        <button class="flow-link" on:click={() => openFlow($selectedSymbol, 'out')}>view as flow →</button>
      {/if}
    </div>
    {#each symCallees as [id, w] (id)}
      <button class="rel-row" on:click={() => jumpToSymbol(id)}>
        <span class="rel-dot" style="background:var(--calls)"></span>
        <span class="nm">{DATA.symbols[id][0]} <span style="color:var(--muted)">· {displayName(DATA.files[DATA.symbols[id][4]][0])}</span></span>
        <span class="w">{w}</span>
      </button>
    {/each}

    {#if relatedTests.length > 0}
      <div class="panel-title-row" style="margin-top:14px;">
        <div class="panel-title" style="margin:0;">Tested by ({relatedTests.length})</div>
      </div>
      {#each relatedTests as id (id)}
        <button class="rel-row" on:click={() => jumpToSymbol(id)}>
          <span class="rel-dot" style="background:#3fa77f"></span>
          <span class="nm">{DATA.symbols[id][0]} <span style="color:var(--muted)">· {displayName(DATA.files[DATA.symbols[id][4]][0])}</span></span>
        </button>
      {/each}
    {/if}
  {:else if file}
    <button class="close-btn" on:click={close}>✕</button>
    <h2 class="mono">{displayName(file[0])}</h2>
    <div class="path-pkg">
      <a class="path-link" href={vscodeUri(file[0])} data-tip={projectRoot ? 'Open in VS Code' : 'No project root — links disabled'}>{file[0]}</a>
      {#if projectRoot}
        <a class="open-ide" href={vscodeUri(file[0])} data-tip="Open in VS Code" aria-label="Open in VS Code">↗</a>
      {/if}
    </div>
    <div class="kv-grid">
      <div class="k">Package</div><div class="v" style="color:{pkgColor(file[1])}">{shortPkg(DATA.packages[file[1]][0])}</div>
      <div class="k">Language</div><div class="v">{file[2]}</div>
      <div class="k">Symbols</div><div class="v">{symIds.length}</div>
    </div>

    <div class="panel-title">Symbols</div>
    {#each symGroups as g (g.kind)}
      <div class="sym-group">
        <div class="sym-group-title">{g.kind} ({g.total})</div>
        {#each g.items as id (id)}
          <button class="sym-row" class:exported={!!DATA.symbols[id][3]} on:click={() => selectSymbol(id)}>
            <span class="nm">{DATA.symbols[id][0]}</span><span class="ln">L{DATA.symbols[id][2]}</span>
          </button>
        {/each}
      </div>
    {/each}

    <div class="panel-title">Callers / importers ({fileCallers.length})</div>
    {#each fileCallers as [idx, kind, w] (idx + '-' + kind)}
      <button class="rel-row" on:click={() => jumpToFile(idx)}>
        <span class="rel-dot" style="background:{kind === 0 ? 'var(--imports)' : 'var(--calls)'}"></span>
        <span class="nm">{DATA.files[idx][0]}</span>
        <span class="w">{w}</span>
      </button>
    {/each}

    <div class="panel-title" style="margin-top:12px;">Calls / imports ({fileCallees.length})</div>
    {#each fileCallees as [idx, kind, w] (idx + '-' + kind)}
      <button class="rel-row" on:click={() => jumpToFile(idx)}>
        <span class="rel-dot" style="background:{kind === 0 ? 'var(--imports)' : 'var(--calls)'}"></span>
        <span class="nm">{DATA.files[idx][0]}</span>
        <span class="w">{w}</span>
      </button>
    {/each}
  {/if}
</div>

<style>
  .panel-title-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }
  .flow-link {
    font-size: 10.5px;
    font-weight: 700;
    color: var(--accent);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    white-space: nowrap;
  }
  .flow-link:hover { text-decoration: underline; }

  /* VS Code deep link — the file path becomes a clickable link that opens
     the file in VS Code via the vscode:// protocol. Hover reveals the
     accent color so it's discoverable without breaking the visual flow.
     Long paths wrap inside the detail panel (overflow-wrap: anywhere)
     instead of pushing the layout into horizontal scroll. */
  .path-link {
    color: var(--text);
    text-decoration: none;
    border-bottom: 1px dotted transparent;
    transition: border-color 0.1s ease, color 0.1s ease;
    overflow-wrap: anywhere;
    word-break: break-all;
  }
  .path-link:hover { color: var(--accent); border-bottom-color: var(--accent); }
  .open-ide {
    color: var(--muted);
    text-decoration: none;
    margin-left: 4px;
    font-size: 13px;
    line-height: 1;
    flex: 0 0 auto;
    vertical-align: middle;
  }
  .open-ide:hover { color: var(--accent); }

  .qualified-name {
    font-size: 11px;
    color: var(--muted);
    margin: -6px 0 6px 0;
    overflow-wrap: anywhere;
  }
  .dead-pill {
    font-size: 10.5px;
    font-family: var(--vscode-font-family, "Manrope", sans-serif);
    font-weight: 600;
    color: #c94f7c;
    background: rgba(201, 79, 124, 0.14);
    border-radius: 4px;
    padding: 2px 7px;
    margin-left: 8px;
    vertical-align: middle;
    text-wrap: nowrap;
  }
  .pkg-badge {
    font-weight: 600;
  }
  .decorator-row {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-bottom: 8px;
  }
  .decorator-chip {
    font-size: 11px;
    color: var(--accent);
    background: var(--accent-soft);
    border-radius: 4px;
    padding: 1px 6px;
  }
  .flag-row {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-bottom: 8px;
  }
  .flag-badge {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    background: var(--surface-2);
    border: 1px solid var(--border);
    padding: 2px 7px;
    border-radius: 10px;
  }
  .flag-badge.returns {
    color: var(--accent);
    text-transform: none;
    letter-spacing: 0;
    font-weight: 600;
  }
  .real-sig {
    font-size: 11.5px;
    color: var(--text);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 9px;
    margin-bottom: 12px;
    overflow-x: auto;
    white-space: pre;
  }

  .doc {
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text);
    background: var(--accent-soft);
    border-radius: 8px;
    padding: 9px 11px;
    margin: 0 0 14px 0;
    white-space: pre-wrap;
  }
  .snippet {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 4px 0;
    font-size: 11.5px;
    line-height: 1.5;
    overflow-x: auto;
    margin: 0 0 4px 0;
  }
  .snippet-line {
    display: flex;
    align-items: flex-start;
    padding: 0 10px;
    min-width: max-content;
  }
  .snippet-line:hover { background: var(--accent-soft); }
  .snippet-line .ln {
    flex: 0 0 auto;
    width: 38px;
    text-align: right;
    margin-right: 12px;
    color: var(--muted);
    text-decoration: none;
    user-select: none;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    border: none;
  }
  .snippet-line .ln:hover { color: var(--accent); }
  .snippet-line .code {
    flex: 1 1 auto;
    white-space: pre;
  }
  .snippet-line.truncated { padding-top: 4px; color: var(--muted); }
  .snippet-line.truncated .trunc { font-style: italic; font-size: 11px; }
  .empty-hint {
    font-size: 12px;
    color: var(--muted);
    padding: 4px 0 8px 0;
  }
  .sym-row { width: 100%; cursor: pointer; background: none; border: none; text-align: left; }
  .sym-row:hover { background: var(--accent-soft); }
  .complexity-pill {
    display: inline-block;
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    font-weight: 700;
    font-size: 12px;
    padding: 2px 8px;
    border-radius: 10px;
    background: var(--surface-2);
    color: var(--text);
  }
  .complexity-pill.complex-med { background: rgba(201, 161, 63, 0.18); color: #c9a13f; }
  .complexity-pill.complex-high { background: rgba(201, 79, 124, 0.18); color: #c94f7c; }

  /* Markdown docstring (rendered by marked + sanitized by DOMPurify). */
  .doc.markdown {
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--text);
    background: var(--accent-soft);
    border-radius: 8px;
    padding: 9px 11px;
    margin: 0 0 14px 0;
  }
  .doc.markdown :global(p) { margin: 0 0 8px 0; }
  .doc.markdown :global(p:last-child) { margin-bottom: 0; }
  .doc.markdown :global(h1),
  .doc.markdown :global(h2),
  .doc.markdown :global(h3),
  .doc.markdown :global(h4) {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    margin: 10px 0 4px 0;
  }
  .doc.markdown :global(h1) { font-size: 13px; }
  .doc.markdown :global(ul),
  .doc.markdown :global(ol) { margin: 4px 0 8px 0; padding-left: 20px; }
  .doc.markdown :global(li) { margin: 2px 0; }
  .doc.markdown :global(code) {
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    font-size: 11px;
    background: rgba(91, 94, 214, 0.12);
    color: var(--accent);
    padding: 1px 4px;
    border-radius: 3px;
  }
  .doc.markdown :global(pre) {
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    font-size: 11px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    margin: 6px 0;
    overflow-x: auto;
  }
  .doc.markdown :global(pre code) { background: none; padding: 0; color: var(--text); }
  .doc.markdown :global(a) { color: var(--accent); text-decoration: underline; }
  .doc.markdown :global(blockquote) {
    border-left: 3px solid var(--border);
    margin: 6px 0;
    padding: 2px 0 2px 10px;
    color: var(--muted);
  }

  /* Signature / type-body block: param table + generics + return badge. */
  .sig-block { margin: 0 0 14px 0; }
  .param-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11.5px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }
  .param-table th {
    text-align: left;
    font-weight: 700;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: 9.5px;
    padding: 5px 9px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .param-table td {
    padding: 5px 9px;
    border-top: 1px solid var(--border);
    vertical-align: top;
  }
  .param-table tr:first-child td { border-top: none; }
  .param-table .name { color: var(--text); white-space: nowrap; }
  .param-table .type { color: var(--accent); word-break: break-word; }
  .param-table .muted { color: var(--muted); font-size: 11px; }
  .generics {
    margin-top: 6px;
    font-size: 11px;
    color: var(--muted);
  }
  .returns {
    margin-top: 8px;
    font-size: 11.5px;
    display: flex;
    align-items: baseline;
    gap: 6px;
    flex-wrap: wrap;
  }
  .badge {
    display: inline-block;
    font-size: 9.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent);
    background: var(--accent-soft);
    padding: 2px 7px;
    border-radius: 10px;
    margin-top: 8px;
  }
</style>
