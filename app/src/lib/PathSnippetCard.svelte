<script>
  // One card in the "walk this path" snippet grid (AllFlowsView) — renders
  // symId's source windowed around the line where it calls calleeSymId,
  // with a line-number gutter and syntax highlighting. Split out of
  // AllFlowsView because this logic (exact call-site resolution, the
  // name-match fallback, and the context-window slicing) is a self-
  // contained ~150-line unit that doesn't need anything else in that file.
  import { DATA, symOutAdj } from './stores.js';
  import { jumpToSymbol } from './actions.js';
  import { highlightLine } from './highlight.js';

  export let symId;
  export let calleeSymId; // null when this is the last node in the path (no further call to highlight)
  export let isRoot = false;
  export let idx; // position of this node in the walked path (0-based)

  $: s = DATA.symbols[symId];
  $: lang = DATA.files[s[4]][2];
  $: title = `${s[1]} · ${DATA.files[s[4]][0]}`;

  // Source snippet text for a symbol, or empty string if none captured.
  function snippetFor(id) {
    return DATA.symbols[id][5] || '';
  }

  // Real call-site line numbers (edges.line in the CodeGraph DB, plumbed
  // through as symbolEdges[*][3]) — the exact line(s) inside symId's body
  // where it calls calleeSymId, as absolute source-file line numbers.
  // CodeGraph can't resolve a JSX component reference to a real call
  // expression, so for `component`-kind targets (and sometimes plain
  // functions referenced indirectly) it stamps the edge's line as the
  // *caller's own declaration line* instead — indistinguishable from a
  // real call that happens to land on line 1. Since a real call can never
  // land exactly on its own function's signature line, drop any line equal
  // to symId's start line as unreliable and let the caller fall back to
  // the name-match search.
  function callSiteLines(id, calleeId) {
    const entry = symOutAdj.get(id)?.find(([tid]) => tid === calleeId);
    const lines = entry?.[2];
    if (!lines || !lines.length) return null;
    const startLine = DATA.symbols[id][2];
    const real = lines.filter((ln) => ln !== startLine);
    return real.length ? real : null;
  }

  // Splits a symbol's snippet into lines, flagging the line(s) where it
  // calls `calleeId` (the next hop in the path) so the template can
  // highlight it. Prefers exact call-site line numbers from the graph;
  // falls back to a word-boundary name match when no reliable line data is
  // available (older export, or a JSX component reference — see
  // callSiteLines above).
  function snippetLines(id, calleeId) {
    const text = snippetFor(id);
    const lines = text.split('\n');
    const startLine = DATA.symbols[id][2];
    const callLines = calleeId !== null ? callSiteLines(id, calleeId) : null;
    if (callLines) {
      const hitSet = new Set(callLines.map((ln) => ln - startLine));
      return lines.map((line, i) => ({ text: line, hit: hitSet.has(i) }));
    }
    const calleeName = calleeId !== null ? DATA.symbols[calleeId]?.[0] : null;
    const re = calleeName ? new RegExp(`\\b${calleeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`) : null;
    return lines.map((line) => ({ text: line, hit: !!re && re.test(line) }));
  }

  const WINDOW_BEFORE = 4;
  const WINDOW_AFTER = 10;
  const MAX_WINDOW = 40;

  // A symbol's full body can run to hundreds of lines, but the call site
  // we care about is one spot in it — showing from the top of the function
  // (the old behavior) often scrolled right past it. Slices the full
  // (already hit-flagged) line list down to a window around the highlighted
  // line(s), tagging each kept line with its real absolute file line number
  // for the gutter. Falls back to the first MAX_WINDOW lines when nothing
  // is highlighted (e.g. the path's last node has no further call to show).
  function windowLines(lines, startLine) {
    const hitIdx = [];
    lines.forEach((l, i) => {
      if (l.hit) hitIdx.push(i);
    });
    let lo, hi;
    if (hitIdx.length) {
      lo = Math.max(0, Math.min(...hitIdx) - WINDOW_BEFORE);
      hi = Math.min(lines.length - 1, Math.max(...hitIdx) + WINDOW_AFTER);
      if (hi - lo + 1 > MAX_WINDOW) hi = lo + MAX_WINDOW - 1;
    } else {
      lo = 0;
      hi = Math.min(lines.length - 1, MAX_WINDOW - 1);
    }
    return {
      hiddenBefore: lo,
      hiddenAfter: Math.max(0, lines.length - 1 - hi),
      lines: lines.slice(lo, hi + 1).map((l, i) => ({ ...l, num: startLine + lo + i })),
    };
  }

  $: win = windowLines(snippetLines(symId, calleeSymId), s[2]);

  // Snippet panes are capped at 260px with their own scroll (see
  // .snippet-code) so a highlighted call line found deep in the function
  // body is otherwise invisible below the fold. Center it as soon as the
  // pane mounts.
  function scrollToHighlight(node) {
    const hl = node.querySelector('.snippet-line.hl');
    if (hl) hl.scrollIntoView({ block: 'center' });
  }
</script>

<div class="snippet-card" class:root={isRoot}>
  <button class="snippet-card-head" on:click={() => jumpToSymbol(symId)} {title}>
    <span class="snippet-idx">{idx}</span>
    <span class="mono">{s[0]}</span>
    <span class="snippet-kind">{s[1]}</span>
  </button>
  <div class="snippet-code" use:scrollToHighlight>
    {#if win.hiddenBefore > 0}
      <div class="snippet-ellipsis">⋯ {win.hiddenBefore} lines above</div>
    {/if}
    {#each win.lines as line (line.num)}
      <div class="snippet-line" class:hl={line.hit}>
        <span class="ln">{line.num}</span><span class="code">{@html highlightLine(line.text, lang)}</span>
      </div>
    {/each}
    {#if win.hiddenAfter > 0}
      <div class="snippet-ellipsis">⋯ {win.hiddenAfter} lines below</div>
    {/if}
  </div>
</div>

<style>
  .snippet-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 5px;
    overflow: hidden;
  }
  .snippet-card.root { border-color: var(--accent); }
  .snippet-card-head {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    background: none;
    border: none;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    text-align: left;
    color: var(--text);
    font-size: 11.5px;
  }
  .snippet-card.root .snippet-card-head { background: var(--accent-soft); }
  .snippet-card-head:hover { background: var(--accent-soft); }
  .snippet-idx {
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    font-size: 9.5px;
    color: var(--muted);
    min-width: 14px;
  }
  .snippet-card-head .mono { font-weight: 700; }
  .snippet-kind {
    margin-left: auto;
    font-size: 9.5px;
    text-transform: uppercase;
    color: var(--muted);
    letter-spacing: 0.04em;
  }

  .snippet-code {
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    font-size: 10.5px;
    line-height: 1.5;
    background: var(--surface);
    max-height: 260px;
    overflow: auto;
  }
  .snippet-line { display: flex; }
  .snippet-line.hl {
    background: var(--accent-soft);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .snippet-line .ln {
    flex: 0 0 auto;
    width: 34px;
    padding: 0 8px 0 4px;
    text-align: right;
    color: var(--muted);
    user-select: none;
  }
  .snippet-line .code {
    flex: 1;
    min-width: 0;
    white-space: pre;
    padding-right: 10px;
    color: var(--text);
  }
  .snippet-ellipsis {
    padding: 3px 10px 3px 46px;
    color: var(--muted);
    font-style: italic;
    font-size: 10px;
  }
  /* highlight.js token colors, mapped onto our theme tokens so code
     coloring stays correct across light/dark without a separate hljs
     theme stylesheet. */
  .code :global(.hljs-keyword),
  .code :global(.hljs-operator) { color: var(--accent); }
  .code :global(.hljs-string),
  .code :global(.hljs-template-string),
  .code :global(.hljs-regexp) { color: var(--calls); }
  .code :global(.hljs-number),
  .code :global(.hljs-literal),
  .code :global(.hljs-built_in) { color: var(--imports); }
  .code :global(.hljs-comment),
  .code :global(.hljs-quote) { color: var(--muted); font-style: italic; }
  .code :global(.hljs-title),
  .code :global(.hljs-title.function_),
  .code :global(.hljs-title.class_) { color: var(--text); font-weight: 700; }
  .code :global(.hljs-tag),
  .code :global(.hljs-name),
  .code :global(.hljs-attr),
  .code :global(.hljs-attribute) { color: var(--danger); }
</style>
