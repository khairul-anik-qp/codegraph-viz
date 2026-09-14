<script>
  // Hover tooltip for a graph node, written in plain terms: what this symbol
  // is, what it does (doc), how connected it is (callers/callees), how big and
  // how complex, and exactly where to find it (file + line).
  import { DATA, tooltipState, symInAdj, symOutAdj } from './stores.js';
  import { complexity } from './graph.js';

  const KIND_LABEL = {
    function: 'Function', method: 'Method', class: 'Class', component: 'Component',
    interface: 'Interface', type_alias: 'Type', constant: 'Constant', variable: 'Variable',
    route: 'Route', enum: 'Enum', struct: 'Struct', trait: 'Trait', module: 'Module',
  };
  // Translates the raw complexity number into a word people can act on.
  function complexityWord(n) {
    if (n <= 5) return 'simple';
    if (n <= 10) return 'moderate';
    if (n <= 20) return 'complex';
    return 'very complex';
  }

  $: t = $tooltipState;
  $: sym = t ? DATA.symbols[t.symId] : null;
  $: callerCount = t ? (symInAdj.get(t.symId) || []).length : 0;
  $: calleeCount = t ? (symOutAdj.get(t.symId) || []).length : 0;
  $: symComplexity = sym ? complexity(sym[5]) : 0;
  $: lineCount = sym && sym[5] ? sym[5].split('\n').length : 0;
  $: filePath = sym ? DATA.files[sym[4]][0] : '';
  $: badges = sym ? [
    sym[3] ? 'exported' : '',
    sym[10] ? 'async' : '',
    sym[11] ? 'static' : '',
    sym[13] ? 'abstract' : '',
  ].filter(Boolean) : [];
  // Doc: first paragraph (blank-line separated), clamped by CSS to 3 lines.
  $: docText = sym && sym[6] ? sym[6].split('\n\n')[0].replace(/\s+/g, ' ').trim() : '';
  // Position: follow the cursor, but flip to the left/above it when the box
  // would otherwise run off the right/bottom edge of the viewport.
  $: pos = t ? (() => {
    const W = 340, H = 280;
    let x = t.x + 16, y = t.y + 16;
    if (typeof window !== 'undefined') {
      if (x + W > window.innerWidth - 8) x = Math.max(8, t.x - W - 16);
      if (y + H > window.innerHeight - 8) y = Math.max(8, t.y - H - 16);
    }
    return { x, y };
  })() : null;
</script>

{#if t && sym && pos}
  <div class="node-tooltip" style="left:{pos.x}px; top:{pos.y}px;">
    <div class="head">
      <span class="kind">{KIND_LABEL[sym[1]] || sym[1]}</span>
      {#each badges as b (b)}<span class="badge">{b}</span>{/each}
    </div>
    <div class="name mono">{sym[0]}</div>
    {#if sym[7]}<div class="signature mono">{sym[7]}</div>{/if}
    {#if docText}<div class="doc">{docText}</div>{/if}
    <div class="stats">
      <div class="stat"><span class="label">Called by</span><span class="value">{callerCount}</span></div>
      <div class="stat"><span class="label">Calls</span><span class="value">{calleeCount}</span></div>
      <div class="stat"><span class="label">Size</span><span class="value">{lineCount} lines</span></div>
      <div class="stat"><span class="label">Complexity</span><span class="value">{complexityWord(symComplexity)} ({symComplexity})</span></div>
    </div>
    <div class="file mono" data-tip={filePath}>{filePath} : line {sym[2]}</div>
  </div>
{/if}

<style>
  .node-tooltip {
    position: fixed;
    z-index: 200;
    pointer-events: none;
    width: 320px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px 14px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    font-family: var(--vscode-font-family, 'Manrope', sans-serif);
    font-size: 12px;
    color: var(--text);
  }
  .mono { font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 4px;
  }
  .kind {
    color: var(--accent);
    text-transform: uppercase;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
  }
  .badge {
    color: var(--muted);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 5px;
    font-size: 9.5px;
  }
  .name {
    font-weight: 700;
    font-size: 14px;
    margin-bottom: 4px;
    word-break: break-all;
  }
  .signature {
    color: var(--muted);
    font-size: 10.5px;
    margin-bottom: 6px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .doc {
    color: var(--text);
    font-size: 11.5px;
    line-height: 1.4;
    margin-bottom: 8px;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .stats {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 10px;
    padding: 8px 0;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    margin-bottom: 8px;
  }
  .stat .label { color: var(--muted); }
  .stat .value { text-align: right; font-weight: 600; }
  .file {
    color: var(--muted);
    font-size: 10.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
