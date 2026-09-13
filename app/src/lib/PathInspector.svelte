<script>
  // Full-screen focused view of a single path — a vertical chain of symbol
  // cards with full source, no list controls. Shown by AllFlowsView in
  // place of the path list whenever $inspectedPath targets the current
  // root; reads $inspectedPath itself rather than taking it as a prop
  // since that's the one thing this view is entirely built around.
  import { DATA, inspectedPath, setFlowName } from './stores.js';
  import { jumpToSymbol, openAllFlows } from './actions.js';
  import { pkgColor, displayName } from './graph.js';
  import { highlightBlock } from './highlight.js';

  $: ins = $inspectedPath;

  // Closes the inspector, returning to the all-flows path list.
  function exitInspector() {
    inspectedPath.set(null);
  }

  // "re-root here" — picks any node in the focused path and re-roots the
  // all-flows at that node. Different from openFlow (which re-roots the
  // single-flow d3 view) — here we want a fresh path enumeration, so we go
  // through openAllFlows which recomputes callers + callees for the new
  // symbol.
  function inspectorRerootAt(symId) {
    openAllFlows(symId);
  }

  // Copy the path as a human-readable string — useful for pasting into PR
  // comments / notes.
  async function copyPathString(path, dir) {
    const ordered = dir === 'callers' ? path.slice().reverse() : path;
    const str = ordered.map((id) => DATA.symbols[id]?.[0] || '?').join(' → ');
    try {
      await navigator.clipboard.writeText(str);
    } catch {
      /* ignore */
    }
  }
</script>

<div class="inspector">
  <div class="inspector-head">
    <button class="back-btn" on:click={exitInspector} title="Back to all flows">← back to all flows</button>
    <input
      class="inspector-title"
      type="text"
      placeholder="name this flow…"
      value={ins.name || ''}
      on:blur={(e) => setFlowName(ins.rootId, ins.path, e.target.value)}
      on:keydown={(e) => {
        if (e.key === 'Enter') e.target.blur();
      }}
    />
    <div class="inspector-meta">
      <span class="dir-badge" class:callers={ins.dir === 'callers'} class:callees={ins.dir === 'callees'}>
        {ins.dir === 'callers' ? '↑ callers' : '↓ callees'}
      </span>
      <span class="len-pill">len {ins.path.length}</span>
      <button class="meta-btn" on:click={() => copyPathString(ins.path, ins.dir)} title="Copy path as `a → b → c`">copy</button>
    </div>
  </div>
  <div class="inspector-body">
    {#each ins.path as symId, j (j)}
      {@const s = DATA.symbols[symId]}
      {@const file = DATA.files[s[4]]}
      <div class="ins-card" class:root={symId === ins.rootId} style="--card-accent: {pkgColor(file[1])}">
        <div class="ins-card-head">
          <span class="ins-idx">{j}</span>
          <button class="ins-name mono" on:click={() => jumpToSymbol(symId)} title={file[0]}>{s[0]}</button>
          <span class="ins-kind">{s[1]}</span>
          <span class="ins-file mono">{displayName(file[0])}:{s[2]}</span>
          <button class="ins-reroot" on:click={() => inspectorRerootAt(symId)} title="Re-root all-flows at this symbol">re-root ↗</button>
        </div>
        <pre class="ins-src mono">{@html s[5] ? highlightBlock(s[5], file[2]) : '(no snippet)'}</pre>
      </div>
      {#if j < ins.path.length - 1}
        <div class="ins-connector" title={ins.dir === 'callers' ? 'caller → callee' : 'caller → callee'}>
          {ins.dir === 'callers' ? '↑' : '↓'}
        </div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .inspector {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    padding: 16px 20px 32px;
    font-family: var(--vscode-font-family, 'Manrope', sans-serif);
    color: var(--text);
  }
  .inspector-head {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    padding: 12px 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: 8px;
    margin-bottom: 16px;
  }
  .back-btn {
    background: var(--surface-2);
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 5px 12px;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .back-btn:hover { color: var(--accent); border-color: var(--accent); }
  .inspector-title {
    flex: 1 1 240px;
    min-width: 200px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 12px;
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    font-size: 14px;
    font-weight: 700;
    color: var(--text);
  }
  .inspector-title::placeholder { color: var(--muted); font-weight: 400; font-style: italic; }
  .inspector-title:focus { outline: none; border-color: var(--accent); background: var(--surface); }
  .inspector-meta { display: flex; align-items: center; gap: 8px; }
  .dir-badge {
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    font-size: 10.5px;
    font-weight: 700;
    padding: 3px 9px;
    border-radius: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .dir-badge.callers { background: var(--surface-2); color: var(--muted); border: 1px solid var(--border); }
  .dir-badge.callees { background: var(--accent-soft); color: var(--accent); border: 1px solid var(--accent); }
  .len-pill {
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    font-size: 11px;
    color: var(--muted);
    background: var(--surface-2);
    padding: 3px 8px;
    border-radius: 4px;
  }
  .meta-btn {
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--muted);
    border-radius: 4px;
    padding: 4px 10px;
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    cursor: pointer;
  }
  .meta-btn:hover { color: var(--text); border-color: var(--accent); }

  .inspector-body {
    display: flex;
    flex-direction: column;
    gap: 0;
    max-width: 920px;
    margin: 0 auto;
  }
  .ins-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-left: 3px solid var(--card-accent, var(--border));
    border-radius: 8px;
    overflow: hidden;
  }
  .ins-card.root { border-color: var(--accent); border-left-color: var(--accent); }
  .ins-card-head {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    padding: 8px 12px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
  }
  .ins-card.root .ins-card-head { background: var(--accent-soft); }
  .ins-idx {
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    font-size: 10px;
    font-weight: 700;
    color: var(--muted);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 2px 6px;
    min-width: 22px;
    text-align: center;
  }
  .ins-card.root .ins-idx { color: var(--accent); border-color: var(--accent); }
  .ins-name {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--text);
    font-weight: 700;
    font-size: 13px;
  }
  .ins-name:hover { color: var(--accent); text-decoration: underline; }
  .ins-kind {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 2px 6px;
  }
  .ins-file { font-size: 11px; color: var(--muted); }
  .ins-reroot {
    margin-left: auto;
    background: none;
    border: 1px solid var(--border);
    color: var(--muted);
    border-radius: 4px;
    padding: 3px 9px;
    font-family: inherit;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    cursor: pointer;
  }
  .ins-reroot:hover { color: var(--accent); border-color: var(--accent); }
  .ins-src {
    margin: 0;
    padding: 10px 14px;
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--text);
    background: var(--surface);
    overflow-x: auto;
    white-space: pre;
    max-height: 360px;
    overflow-y: auto;
  }
  /* highlight.js token colors, mapped onto our theme tokens (see
     PathSnippetCard.svelte for the same mapping). */
  .ins-src :global(.hljs-keyword),
  .ins-src :global(.hljs-operator) { color: var(--accent); }
  .ins-src :global(.hljs-string),
  .ins-src :global(.hljs-template-string),
  .ins-src :global(.hljs-regexp) { color: var(--calls); }
  .ins-src :global(.hljs-number),
  .ins-src :global(.hljs-literal),
  .ins-src :global(.hljs-built_in) { color: var(--imports); }
  .ins-src :global(.hljs-comment),
  .ins-src :global(.hljs-quote) { color: var(--muted); font-style: italic; }
  .ins-src :global(.hljs-title),
  .ins-src :global(.hljs-title.function_),
  .ins-src :global(.hljs-title.class_) { color: var(--text); font-weight: 700; }
  .ins-src :global(.hljs-tag),
  .ins-src :global(.hljs-name),
  .ins-src :global(.hljs-attr),
  .ins-src :global(.hljs-attribute) { color: var(--danger); }
  .ins-connector {
    text-align: center;
    color: var(--accent);
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    font-size: 14px;
    font-weight: 700;
    padding: 4px 0;
  }
</style>
