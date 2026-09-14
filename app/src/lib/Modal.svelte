<script>
  // Generic centered-overlay modal shell: backdrop, Escape-to-close, X button.
  // Reused by PathFinderModal, KeyboardShortcutsHelp, and SourceModal.
  import { createEventDispatcher } from 'svelte';
  export let open = false;
  export let title = '';
  export let wide = false;
  const dispatch = createEventDispatcher();
  // Notifies the parent to close the modal.
  function close() { dispatch('close'); }
  // Closes the modal when Escape is pressed while it's open.
  function onKeydown(e) { if (e.key === 'Escape') close(); }
  // Closes the modal only when the backdrop itself (not the dialog box) is clicked.
  function onBackdropClick(e) { if (e.target === e.currentTarget) close(); }
</script>

<svelte:window on:keydown={open ? onKeydown : null} />

{#if open}
  <div class="modal-backdrop" role="presentation" on:click={onBackdropClick} on:keydown={onKeydown}>
    <div class="modal-box" class:wide role="dialog" aria-modal="true" aria-label={title}>
      <div class="modal-head">
        <h3>{title}</h3>
        <button class="modal-close" on:click={close}>✕</button>
      </div>
      <div class="modal-body">
        <slot />
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 300;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 10vh;
  }
  .modal-box {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    width: min(560px, 92vw);
    max-height: 76vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
    font-family: var(--vscode-font-family, 'Manrope', sans-serif);
  }
  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }
  .modal-head h3 { margin: 0; font-size: 14px; color: var(--text); }
  .modal-close {
    background: none;
    border: none;
    color: var(--muted);
    font-size: 14px;
    cursor: pointer;
  }
  .modal-close:hover { color: var(--accent); }
  .modal-box.wide { width: min(880px, 94vw); }
  .modal-body {
    padding: 14px 16px;
    overflow-y: auto;
  }
</style>
