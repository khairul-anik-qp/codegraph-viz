import { writable, derived, get } from 'svelte/store';
import { loadGraphData, buildAdjacency, findDeadCode, findCycles } from './graph.js';

export const DATA = loadGraphData();

const fileAdj = buildAdjacency(DATA.fileEdges);
export const fileOutAdj = fileAdj.out;
export const fileInAdj = fileAdj.inn;

const pkgAdj = buildAdjacency(DATA.packageEdges);
export const pkgOutAdj = pkgAdj.out;
export const pkgInAdj = pkgAdj.inn;

// Symbol-level call graph — who calls this specific function/method/etc,
// separate from the file-level graph used for the canvas visualization.
const symAdj = buildAdjacency(DATA.symbolEdges);
export const symOutAdj = symAdj.out; // symId -> [[calleeSymId, weight]]
export const symInAdj = symAdj.inn;  // symId -> [[callerSymId, weight]]

// Non-call reachability: references/extends/implements/instantiates (see
// graph.js's DATA-shape doc for symbolUsageEdges). symUsageInAdj.get(id) is
// what makes findDeadCode() accurate for types/constants/base classes,
// which are never "called" but very much used.
const symUsageAdj = buildAdjacency(DATA.symbolUsageEdges || []);
export const symUsageOutAdj = symUsageAdj.out;
export const symUsageInAdj = symUsageAdj.inn;

// ---------- all-flows view (enumerate every path through a symbol) ----------
export const allFlowsRoot = writable(null);          // symId being analyzed
export const allFlowsCallerPaths = writable([]);     // upstream paths (who calls root)
export const allFlowsCalleePaths = writable([]);     // downstream paths (what root calls)
export const allFlowsCaps = writable({ depth: 5, maxPaths: 500, maxChildren: 8 });
export const allFlowsTruncated = writable({ callers: false, callees: false });

// Named flows — user-labeled paths the AllFlowsView exposes. Persisted in
// localStorage keyed by the indexed code's projectRoot + a per-path hash, so
// the same labeled flow survives page reloads but doesn't leak across
// different indexed projects. Schema:
//   { "codegraph-named-flows:<rootId>:<pathHash>": "<user name>" }
// Path hash: sha-like join of symIds in the path, stable as long as the
// underlying graph data doesn't change. Inspector-mode uses pathHash to
// remember which path the user is currently focusing on.
const NAMED_FLOWS_KEY = 'codegraph-named-flows';
function loadNamedFlows() {
  if (typeof localStorage === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(NAMED_FLOWS_KEY) || '{}') || {}; }
  catch { return {}; }
}
function saveNamedFlows(map) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(NAMED_FLOWS_KEY, JSON.stringify(map)); } catch { /* quota */ }
}
export const namedFlows = writable(loadNamedFlows());
namedFlows.subscribe(saveNamedFlows);

export function pathHash(path) {
  // Stable identifier for a path — join symIds with a separator that can't
  // appear inside a symId (always non-negative integers). Used as the key
  // component in namedFlows and as a key for the inspector state.
  return path.join('-');
}
export function setFlowName(rootId, path, name) {
  const key = `${rootId}:${pathHash(path)}`;
  namedFlows.update(m => {
    const next = { ...m };
    if (name && name.trim()) next[key] = name.trim();
    else delete next[key];
    return next;
  });
}
export function getFlowName(rootId, path) {
  const key = `${rootId}:${pathHash(path)}`;
  return get(namedFlows)[key] || '';
}

// ---------- flow inspector ----------
// When non-null, the AllFlowsView swaps to a focused single-path view
// instead of the full path list. The path is the array of symIds in order.
// Set by the per-row "focus →" button, cleared by the inspector's back
// button. Lives in stores (not local state) so the back button can be in
// the Header breadcrumb if we want a global escape hatch later.
export const inspectedPath = writable(null); // { rootId, dir, path, name } | null

// ---------- navigation ----------
export const view = writable('packages'); // 'packages' | 'files' | 'flow' | 'allFlows'
export const currentPkg = writable(null);

// ---------- flow view ----------
export const flowRoot = writable(null);        // symId currently rooted
export const flowDirection = writable('out');  // 'out' = calls (downstream), 'in' = called by (upstream)
export const flowDepth = writable(3);
export const flowTrail = writable([]);         // stack of previous root symIds, for back navigation
export const flowFeatureFilter = writable(null); // Features/<name> to isolate among the root's children, or null for all

// ---------- isolate mode ----------
export const isolate = writable(null); // { type: 'pkg'|'file', idx, name, visible: Set }
export const hop = writable(99);
export const direction = writable('both');

// ---------- edge filters ----------
export const showImports = writable(true);
export const showCalls = writable(true);

// ---------- selection / search ----------
export const selectedFile = writable(null);
export const selectedSymbol = writable(null); // global symbol id, or null for file-overview
export const searchQuery = writable('');

// ---------- hover tooltip ----------
// { x, y, symId } in viewport coordinates, or null when nothing is hovered.
// A single shared store so only one NodeTooltip instance needs to exist
// (mounted once in App.svelte) no matter which view is showing nodes.
export const tooltipState = writable(null);

// ---------- path finder modal ----------
// Whether the Path Finder modal is open. Reset to false on close (backdrop
// click, Escape, X button — all routed through Modal's `on:close`, which
// PathFinderModal.close() handles — or automatically after jumping to a
// symbol in the resulting chain).
export const pathFinderOpen = writable(false);

// ---------- package focus ----------
// null = no restriction (everything). A Set of package indices otherwise —
// scopes search results, dims non-matching packages in the package view,
// and prunes the flow diagram to only that package's functions.
export const packageFilter = writable(null);

// Set to a file index to ask the currently-mounted FileView to isolate,
// zoom to, and open the detail panel for that file; consumed then cleared.
export const focusRequest = writable(null);

// ---------- search filters ----------
// A Set of symbol-kind names (e.g. 'function', 'method', 'class') to keep
// visible across the app — null means "all kinds". Used by sidebar search
// results, the all-flows view, and the flow diagram to scope what shows up.
export const symbolKindFilter = writable(null);

// ---------- dead code ----------
// Computed once on import: every symbol with zero callers in the call graph,
// flagged by whether it's exported (exported+no-callers = "probably dead",
// unexported+no-callers = "definitely dead"). The list is static since the
// DATA never changes after export.
export const deadCodeSymbols = writable([]);
export const cycleGroups = writable({ sccs: [], map: new Map() });

export const breadcrumb = derived([view, currentPkg], ([$view, $currentPkg]) => {
  if ($view === 'packages') return ['Packages'];
  return ['Packages', DATA.packages[$currentPkg]?.[0] ?? ''];
});

export function clearIsolate() {
  isolate.set(null);
}

// Pre-computed at startup (call graph is static): dead-code list + Tarjan SCCs
// for cycle-grouping in flow views. Both are O(N+E) on the symbol graph —
// cheap enough to run synchronously when the bundle loads. Done last so all
// the writable store references above are past their TDZ initialisation.
deadCodeSymbols.set(findDeadCode(DATA.symbols, symInAdj, symUsageInAdj));
cycleGroups.set(findCycles(symOutAdj));
