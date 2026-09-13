<script>
  import { createEventDispatcher } from 'svelte';
  import { highlightBlock } from './highlight.js';
  import Modal from './Modal.svelte';

  export let open = false;
  export let name = '';
  export let snippet = '';
  export let language = '';
  export let filePath = '';
  export let startLine = 1;

  const dispatch = createEventDispatcher();
  function close() { dispatch('close'); }

  $: html = snippet ? highlightBlock(snippet, language) : '';
  $: lineCount = snippet ? snippet.split('\n').length : 0;

  let copied = false;
  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch { /* clipboard unavailable */ }
  }
</script>

<Modal open={open} wide title={`${name} · ${filePath}:${startLine}`} on:close={close}>
  <div class="src-toolbar">
    <span class="muted">{lineCount} lines</span>
    <button class="copy-btn" on:click={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
  </div>
  <pre class="src-block"><code>{@html html}</code></pre>
</Modal>

<style>
  .src-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    font-size: 11.5px;
  }
  .muted { color: var(--muted); }
  .copy-btn {
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 3px 9px;
    font-size: 11px;
    cursor: pointer;
  }
  .copy-btn:hover { color: var(--accent); border-color: var(--accent); }
  .src-block {
    margin: 0;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    overflow-x: auto;
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    font-size: 12px;
    line-height: 1.5;
  }
</style>
