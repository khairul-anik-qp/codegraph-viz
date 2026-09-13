<script>
  import { DATA, tooltipState, symInAdj, symOutAdj } from './stores.js';
  import { complexity, displayName } from './graph.js';

  $: t = $tooltipState;
  $: sym = t ? DATA.symbols[t.symId] : null;
  $: callerCount = t ? (symInAdj.get(t.symId) || []).length : 0;
  $: calleeCount = t ? (symOutAdj.get(t.symId) || []).length : 0;
  $: symComplexity = sym ? complexity(sym[5]) : 0;
  $: firstDocLine = sym && sym[6] ? sym[6].split('\n')[0] : '';
</script>

{#if t && sym}
  <div class="node-tooltip" style="left:{t.x + 14}px; top:{t.y + 14}px;">
    <div class="row1">
      <span class="kind">{sym[1]}</span>
      <span class="name mono">{sym[0]}</span>
    </div>
    <div class="row2">
      <span title="Heuristic cyclomatic complexity">cx {symComplexity}</span>
      <span title="Direct callers">↓ {callerCount} in</span>
      <span title="Direct callees">↑ {calleeCount} out</span>
    </div>
    {#if firstDocLine}<div class="doc">{firstDocLine}</div>{/if}
    <div class="file mono">{displayName(DATA.files[sym[4]][0])}</div>
  </div>
{/if}

<style>
  .node-tooltip {
    position: fixed;
    z-index: 200;
    pointer-events: none;
    max-width: 280px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 10px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    font-family: var(--vscode-font-family, 'Manrope', sans-serif);
    font-size: 11px;
    color: var(--text);
  }
  .row1 {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin-bottom: 4px;
  }
  .kind {
    color: var(--muted);
    text-transform: uppercase;
    font-size: 9.5px;
    letter-spacing: 0.04em;
  }
  .name { font-weight: 700; }
  .mono { font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); }
  .row2 {
    display: flex;
    gap: 10px;
    color: var(--muted);
    font-size: 10.5px;
    margin-bottom: 4px;
  }
  .doc {
    color: var(--text);
    margin-bottom: 4px;
    line-height: 1.3;
  }
  .file {
    color: var(--muted);
    font-size: 10px;
  }
</style>
