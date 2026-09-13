<script>
  import { shortcutsHelpOpen } from './stores.js';
  import Modal from './Modal.svelte';

  const SHORTCUTS = [
    { key: '/', desc: 'Focus the current search / filter box' },
    { key: 'f', desc: 'Open flow view (calls) for the selected symbol' },
    { key: 'a', desc: 'Open all-paths view for the selected symbol' },
    { key: 'b', desc: 'Back to the previous view' },
    { key: 'p', desc: 'Open the path finder (find a path between any two symbols)' },
    { key: 'e', desc: 'Export the current flow diagram (PNG/SVG)' },
    { key: 'd', desc: 'Toggle the git-diff impact overlay' },
    { key: 'Escape', desc: 'Close the current modal / clear search / deselect / go to Packages' },
    { key: '?', desc: 'Show this help' },
  ];

  function close() { shortcutsHelpOpen.set(false); }
</script>

<Modal open={$shortcutsHelpOpen} title="Keyboard shortcuts" on:close={close}>
  <table class="shortcuts-table">
    <tbody>
      {#each SHORTCUTS as s (s.key)}
        <tr>
          <td><kbd>{s.key}</kbd></td>
          <td>{s.desc}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</Modal>

<style>
  .shortcuts-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .shortcuts-table td { padding: 6px 8px; border-bottom: 1px solid var(--border); color: var(--text); }
  .shortcuts-table td:first-child { width: 70px; }
  kbd {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 2px 6px;
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    font-size: 11.5px;
  }
</style>
