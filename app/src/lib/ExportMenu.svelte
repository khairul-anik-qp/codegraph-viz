<script>
  // Small dropdown button that exports the current flow diagram as PNG or SVG.
  import { svgToSvgString, svgToPngDataUrl } from './export.js';

  export let svgEl = null;
  export let filename = 'flow';

  let openMenu = false;

  // Triggers a browser download for the given data/blob URL.
  function download(href, ext) {
    const a = document.createElement('a');
    a.href = href;
    a.download = `${filename}.${ext}`;
    a.click();
  }

  // Renders the SVG to a PNG data URL and downloads it.
  async function exportPng() {
    if (!svgEl) return;
    const url = await svgToPngDataUrl(svgEl, 2);
    download(url, 'png');
    openMenu = false;
  }

  // Serializes the SVG element and downloads it as an .svg file.
  function exportSvg() {
    if (!svgEl) return;
    const svgString = svgToSvgString(svgEl);
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    download(URL.createObjectURL(blob), 'svg');
    openMenu = false;
  }

  // 'e' keyboard shortcut (App.svelte, flow view only) dispatches this on
  // `window` instead of calling into this component directly — App.svelte
  // doesn't hold a reference to FlowView's svgEl, so the event is the only
  // channel back to whichever ExportMenu instance is currently mounted.
  function onExportShortcut() { exportPng(); }
</script>

<svelte:window on:codegraph:export-flow={onExportShortcut} />
<div class="export-menu">
  <button class="export-btn" title="Export diagram (e)" on:click={() => (openMenu = !openMenu)}>Export ▾</button>
  {#if openMenu}
    <div class="export-dropdown">
      <button on:click={exportPng}>PNG</button>
      <button on:click={exportSvg}>SVG</button>
    </div>
  {/if}
</div>

<style>
  .export-menu { position: relative; }
  .export-btn {
    background: var(--surface-2);
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 10px;
    font-family: var(--vscode-font-family, 'Manrope', sans-serif);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .export-btn:hover { color: var(--accent); border-color: var(--accent); }
  .export-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    z-index: 50;
    overflow: hidden;
  }
  .export-dropdown button {
    display: block;
    width: 100px;
    text-align: left;
    background: none;
    border: none;
    color: var(--text);
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  .export-dropdown button:hover { background: var(--surface-2); }
</style>
