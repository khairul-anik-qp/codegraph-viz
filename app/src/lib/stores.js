import { writable, derived, get } from 'svelte/store';
import { loadGraphData, buildAdjacency, findDeadCode, findCycles, blastRadius } from './graph.js';

// The full exported graph for the currently viewed project — the single source of truth every store below derives from.
export const DATA = loadGraphData();

// File-level call/import graph, used to drive the package-canvas visualization.
const fileAdj = buildAdjacency(DATA.fileEdges);
export const fileOutAdj = fileAdj.out;
export const fileInAdj = fileAdj.inn;

// Package-level aggregate graph, used to drive the top-level packages view.
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

// ---------- detail panel density ----------
// 'overview' hides advanced/structural fields (decorators, type params,
// qualified name, raw parsed signature, visibility/static/abstract flags)
// so a first-time reader isn't confronted with everything at once.
// 'deepdive' shows all of it. Persisted globally (not per-project) since
// it's a reading preference, not project data.
const DETAIL_MODE_KEY = 'codegraph-detail-mode';
/** Reads the persisted detail-panel density preference, defaulting to 'overview' when unset or unavailable. */
function loadDetailMode() {
  if (typeof localStorage === 'undefined') return 'overview';
  try { return localStorage.getItem(DETAIL_MODE_KEY) || 'overview'; }
  catch { return 'overview'; }
}
/** Persists the detail-panel density preference so it survives page reloads. */
function saveDetailMode(mode) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(DETAIL_MODE_KEY, mode); } catch { /* quota */ }
}
// Current detail-panel density ('overview' | 'deepdive'); reset only by the user toggling it, persisted across reloads.
export const detailMode = writable(loadDetailMode());
detailMode.subscribe(saveDetailMode);

// ---------- theme ----------
// 'system' follows prefers-color-scheme (and, inside the VS Code webview,
// the host's live theme regardless of this setting); 'light'/'dark' pin an
// explicit choice via the [data-theme] CSS override. Persisted globally,
// same as detailMode — a reading preference, not project data.
const THEME_MODE_KEY = 'codegraph-theme-mode';
/** Reads the persisted theme preference, defaulting to 'system' when unset or unavailable. */
function loadThemeMode() {
  if (typeof localStorage === 'undefined') return 'system';
  try { return localStorage.getItem(THEME_MODE_KEY) || 'system'; }
  catch { return 'system'; }
}
/** Persists the theme preference so it survives page reloads. */
function saveThemeMode(mode) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(THEME_MODE_KEY, mode); } catch { /* quota */ }
}
// Current theme preference ('system' | 'light' | 'dark'); persisted across reloads.
export const themeMode = writable(loadThemeMode());
themeMode.subscribe(saveThemeMode);
themeMode.subscribe(mode => {
  if (typeof document === 'undefined') return;
  if (mode === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', mode);
});

/** Derives a stable string key identifying a specific call-graph path, for use in named-flow storage and lookup. */
export function pathHash(path) {
  // Stable identifier for a path — join symIds with a separator that can't
  // appear inside a symId (always non-negative integers). Used as the key
  // component in namedFlows and as a key for the inspector state.
  return path.join('-');
}
/** Sets or clears the user-given label for a specific flow path, persisting it to the named-flows store. */
export function setFlowName(rootId, path, name) {
  const key = `${rootId}:${pathHash(path)}`;
  namedFlows.update(m => {
    const next = { ...m };
    if (name && name.trim()) next[key] = name.trim();
    else delete next[key];
    return next;
  });
}
/** Looks up the user-given label for a specific flow path, or '' if it hasn't been named. */
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
// Index of the package currently open in the files view, or null when no package is open.
export const currentPkg = writable(null);

// Views the user has pinned into the sidebar's always-visible primary strip
// (see Sidebar.svelte) — everything else lives in the collapsible "More
// views" catalog below it. 'flow' starts pinned: it's the single-symbol
// call-flow diagram, one of the two core exploration modes (alongside the
// packages graph, which is always reachable via the header breadcrumb and
// doesn't need a nav slot of its own), but previously had no nav entry at
// all — reachable only by clicking a node or a search result's "flow"
// button. Persisted globally, same as detailMode/themeMode: a reading
// preference, not project data.
const PINNED_VIEWS_KEY = 'codegraph-pinned-views';
/** Reads the persisted set of pinned sidebar views, defaulting to just 'flow' when unset or unavailable. */
function loadPinnedViews() {
  if (typeof localStorage === 'undefined') return ['flow'];
  try {
    const raw = JSON.parse(localStorage.getItem(PINNED_VIEWS_KEY));
    return Array.isArray(raw) ? raw : ['flow'];
  } catch { return ['flow']; }
}
/** Persists the pinned-views list so it survives page reloads. */
function savePinnedViews(list) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(PINNED_VIEWS_KEY, JSON.stringify(list)); } catch { /* quota */ }
}
export const pinnedViews = writable(loadPinnedViews());
pinnedViews.subscribe(savePinnedViews);

// ---------- primary sidebar ----------
// Whether the left nav (Sidebar.svelte) is expanded or collapsed to a thin
// strip, to reclaim canvas width. Persisted globally, same as
// detailMode/themeMode: a reading preference, not project data.
const SIDEBAR_OPEN_KEY = 'codegraph-sidebar-open-state';
/** Reads the persisted sidebar open/collapsed state, defaulting to open when unset or unavailable. */
function loadSidebarOpen() {
  if (typeof localStorage === 'undefined') return true;
  try {
    const raw = localStorage.getItem(SIDEBAR_OPEN_KEY);
    return raw === null ? true : raw === '1';
  } catch { return true; }
}
/** Persists the sidebar open/collapsed state so it survives page reloads. */
function saveSidebarOpen(open) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(SIDEBAR_OPEN_KEY, open ? '1' : '0'); } catch { /* quota */ }
}
export const sidebarOpen = writable(loadSidebarOpen());
sidebarOpen.subscribe(saveSidebarOpen);

// ---------- domain view ----------
// Folder-depth used to group packages into coarse "domains" (see
// groupPackagesByDepth in graph.js). Ephemeral — NOT persisted to
// localStorage, unlike detailMode: this is an exploratory dial re-adjusted
// per repo/session, not a stable reading preference.
export const domainDepth = writable(2);

// ---------- flow view ----------
export const flowRoot = writable(null);        // symId currently rooted
export const flowDirection = writable('out');  // 'out' = calls (downstream), 'in' = called by (upstream)
export const flowDepth = writable(3);
export const flowTrail = writable([]);         // stack of previous root symIds, for back navigation
export const flowFeatureFilter = writable(null); // Features/<name> to isolate among the root's children, or null for all

// ---------- isolate mode ----------
export const isolate = writable(null); // { type: 'pkg'|'file', idx, name, visible: Set }
// Maximum hop distance to expand when computing isolate-mode visibility.
export const hop = writable(99);
// Which edge direction(s) isolate mode expands along: 'out' | 'in' | 'both'.
export const direction = writable('both');

// ---------- edge filters ----------
// Whether import edges are drawn on the canvas views.
export const showImports = writable(true);
// Whether call edges are drawn on the canvas views.
export const showCalls = writable(true);

// ---------- selection / search ----------
// Index of the file currently selected/open in the detail panel, or null.
export const selectedFile = writable(null);
export const selectedSymbol = writable(null); // global symbol id, or null for file-overview
// Current text typed into the sidebar search box.
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

// ---------- keyboard shortcuts help modal ----------
// Whether the keyboard shortcuts help modal is open.
export const shortcutsHelpOpen = writable(false);

// ---------- source modal (DetailPanel's expand-to-modal source viewer) ----------
// Shared store (not a component-local boolean) so App.svelte's global
// keydown handler can see it — needed both to prioritize closing just the
// modal on Escape (rather than falling through to deselect the symbol) and
// to suppress other single-key shortcuts while it's open.
export const sourceModalOpen = writable(false);

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
// Call-cycle groups (Tarjan SCCs) over the symbol graph, computed once at startup for cycle-highlighting in flow views.
export const cycleGroups = writable({ sccs: [], map: new Map() });

/** Derives the header breadcrumb trail from the current view and open package. */
export const breadcrumb = derived([view, currentPkg], ([$view, $currentPkg]) => {
  if ($view === 'packages') return ['Packages'];
  return ['Packages', DATA.packages[$currentPkg]?.[0] ?? ''];
});

/** Exits isolate mode, restoring the full graph view. */
export function clearIsolate() {
  isolate.set(null);
}

// ---------- git-diff impact overlay ----------
// Only meaningful when the export was run with `--diff <ref>` (Task 7);
// DATA.changedFileIdxs is [] otherwise, in which case both sets below are
// empty and DiffToggle hides itself entirely (see DiffToggle.svelte).
export const diffOverlayOn = writable(false);
export const changedSymIds = new Set(
  (DATA.changedFileIdxs || []).flatMap(fileIdx => DATA.fileSymbolIds[fileIdx] || [])
);
export const blastRadiusSymIds = blastRadius([...changedSymIds], symInAdj);
export const hasDiffData = changedSymIds.size > 0;

// Pre-computed at startup (call graph is static): dead-code list + Tarjan SCCs
// for cycle-grouping in flow views. Both are O(N+E) on the symbol graph —
// cheap enough to run synchronously when the bundle loads. Done last so all
// the writable store references above are past their TDZ initialisation.
deadCodeSymbols.set(findDeadCode(DATA.symbols, symInAdj, symUsageInAdj));
cycleGroups.set(findCycles(symOutAdj));
