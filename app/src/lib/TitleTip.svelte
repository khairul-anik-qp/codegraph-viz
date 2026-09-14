<script>
  // Global instant tooltip: any element with a `data-tip` attribute gets a
  // zero-delay hover tooltip (native `title` attributes wait ~1s before
  // showing). Mounted once in App.svelte; uses document-level event
  // delegation, so it works on every current and future element — including
  // d3-managed DOM — with no per-element wiring.
  import { onMount } from 'svelte';

  let state = null; // { x, y, text } in viewport coords, or null when hidden
  let current = null; // element currently showing a tip for
  let w = 240, h = 40; // live tip dimensions, for edge flipping

  // Places the tip near the cursor, flipping left/above when it would run
  // off the right/bottom viewport edge.
  function place(x, y) {
    let px = x + 14, py = y + 18;
    if (px + w > window.innerWidth - 8) px = Math.max(8, x - w - 14);
    if (py + h > window.innerHeight - 8) py = Math.max(8, y - h - 18);
    return { x: px, y: py };
  }
  $: pos = state ? place(state.x, state.y) : null;

  onMount(() => {
    // mouseover bubbles, so one listener catches every enter — including
    // elements re-created by d3 or {#key} blocks.
    const onOver = (e) => {
      const t = e.target;
      const el = t && t.closest ? t.closest('[data-tip]') : null;
      if (el === current) return;
      current = el;
      state = el ? { x: e.clientX, y: e.clientY, text: el.getAttribute('data-tip') || '' } : null;
    };
    const onMove = (e) => {
      if (state) state = { ...state, x: e.clientX, y: e.clientY };
    };
    document.addEventListener('mouseover', onOver);
    document.addEventListener('mousemove', onMove);
    return () => {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mousemove', onMove);
    };
  });
</script>

{#if state && state.text}
  <div class="title-tip" style="left:{pos.x}px; top:{pos.y}px;" bind:clientWidth={w} bind:clientHeight={h}>{state.text}</div>
{/if}

<style>
  .title-tip {
    position: fixed;
    z-index: 400;
    pointer-events: none;
    max-width: 280px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 10px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    font-family: var(--vscode-font-family, 'Manrope', sans-serif);
    font-size: 11.5px;
    line-height: 1.4;
    color: var(--text);
    white-space: normal;
    word-break: break-word;
  }
</style>
