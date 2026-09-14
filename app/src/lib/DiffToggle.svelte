<script>
  import { diffOverlayOn, hasDiffData, changedSymIds, blastRadiusSymIds } from './stores.js';
</script>

{#if hasDiffData}
  <button
    class="diff-toggle"
    class:active={$diffOverlayOn}
    data-tip="Toggle git-diff impact overlay (d)"
    on:click={() => diffOverlayOn.update(v => !v)}
  >
    <span class="dot changed"></span>{changedSymIds.size} changed
    <span class="dot affected"></span>{blastRadiusSymIds.size - changedSymIds.size} affected
  </button>
{/if}

<style>
  .diff-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--surface-2);
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 10px;
    font-family: var(--vscode-font-family, 'Manrope', sans-serif);
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    margin-right: 12px;
  }
  .diff-toggle.active { color: var(--text); border-color: var(--accent); }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 2px; }
  .dot.changed { background: #c94f7c; }
  .dot.affected { background: #c9a13f; }
</style>
