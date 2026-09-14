import { get } from 'svelte/store';
import {
  DATA, view, currentPkg, isolate, hop, direction, selectedFile, selectedSymbol,
  fileOutAdj, fileInAdj, pkgOutAdj, pkgInAdj, symOutAdj, symInAdj, focusRequest,
  flowRoot, flowDirection, flowDepth, flowTrail, flowFeatureFilter, packageFilter,
  allFlowsRoot, allFlowsCallerPaths, allFlowsCalleePaths, allFlowsCaps, allFlowsTruncated,
  pinnedViews,
} from './stores.js';
import { bfs, enumerateAllPaths } from './graph.js';

/** Enters isolate mode, showing only nodes reachable from the given package/file within the current hop settings. */
export function setIsolate(type, idx, name) {
  const outAdj = type === 'pkg' ? pkgOutAdj : fileOutAdj;
  const inAdj = type === 'pkg' ? pkgInAdj : fileInAdj;
  const visible = bfs(idx, outAdj, inAdj, get(hop), get(direction));
  isolate.set({ type, idx, name, visible });
}

/** Exits isolate mode, restoring the full graph view. */
export function clearIsolate() {
  isolate.set(null);
}

/** Navigates into a package's file view, resetting any prior selection/isolation. */
export function openPackage(pkgIdx) {
  view.set('files');
  currentPkg.set(pkgIdx);
  isolate.set(null);
  selectedFile.set(null);
  selectedSymbol.set(null);
}

/** Navigates back to the top-level packages view, clearing selection/isolation state. */
export function goToPackagesView() {
  view.set('packages');
  isolate.set(null);
  selectedFile.set(null);
  selectedSymbol.set(null);
}

/** Toggles one of the sidebar's standalone list views (deadCode, hubs, etc.) on/off, clearing any
 *  leftover symbol selection so DetailPanel doesn't stay open across the switch. */
export function toggleListView(name) {
  view.set(get(view) === name ? 'packages' : name);
  selectedFile.set(null);
  selectedSymbol.set(null);
}

/** Adds or removes a view from the sidebar's pinned (always-visible) strip. */
export function togglePinnedView(name) {
  pinnedViews.update(cur => cur.includes(name) ? cur.filter(v => v !== name) : [...cur, name]);
}

// Switches to the file's package (if needed), selects the file + symbol so
// DetailPanel shows them, and asks the file-list view to scroll the row
// into view. Pass symId to land directly on a symbol instead of the file
// overview.
export function jumpToFile(fileIdx, symId = null) {
  const f = DATA.files[fileIdx];
  if (get(view) !== 'files' || get(currentPkg) !== f[1]) {
    currentPkg.set(f[1]);
    view.set('files');
  }
  selectedFile.set(fileIdx);
  selectedSymbol.set(symId);
  focusRequest.set({ fileIdx, symId });
}

// Jumps to a symbol's file and opens that symbol's focused view (snippet +
// callers) directly — used by search hits and caller/callee rows in the
// symbol focus panel.
export function jumpToSymbol(symId) {
  const fileIdx = DATA.symbols[symId][4];
  jumpToFile(fileIdx, symId);
}

// Selects a symbol within the file that's already open (e.g. clicking a row
// in the file's Symbols list) — no navigation needed.
export function selectSymbol(symId) {
  selectedSymbol.set(symId);
}

/** Deselects the current symbol, returning the detail panel to the file-level overview. */
export function backToFileOverview() {
  selectedSymbol.set(null);
}

// ---------- flow view ----------
// Opens the flow diagram rooted at a symbol: 'out' walks what it calls
// (downstream), 'in' walks who calls it (upstream) — one direction at a
// time, matching how the diagram reads (a single flow, not the full graph).
function syncDetailToSymbol(symId) {
  selectedSymbol.set(symId);
  selectedFile.set(DATA.symbols[symId][4]);
}

/** Opens the flow diagram rooted at a symbol, resetting depth/trail/filter for a fresh single-direction trace. */
export function openFlow(symId, dir = 'out') {
  view.set('flow');
  flowRoot.set(symId);
  flowDirection.set(dir);
  flowDepth.set(1);
  flowTrail.set([]);
  flowFeatureFilter.set(null);
  syncDetailToSymbol(symId);
}

// Re-roots the flow diagram at a node the user clicked, pushing the current
// root onto the trail so "back" can return to it. Resets depth to 1 and
// clears any feature filter — both described the OLD root, not the new
// one, and starting shallow again is what keeps each hop navigable instead
// of the tree compounding wider/deeper the more you click around.
export function flowDrillTo(symId) {
  flowTrail.update(t => [...t, get(flowRoot)]);
  flowRoot.set(symId);
  flowDepth.set(1);
  flowFeatureFilter.set(null);
  syncDetailToSymbol(symId);
}

/** Pops the flow trail, returning the diagram to the previously visited root. */
export function flowBack() {
  flowTrail.update(t => {
    if (t.length === 0) return t;
    const prev = t[t.length - 1];
    flowRoot.set(prev);
    flowDepth.set(1);
    flowFeatureFilter.set(null);
    syncDetailToSymbol(prev);
    return t.slice(0, -1);
  });
}

/** Jumps directly to an earlier entry in the flow trail, discarding everything visited after it. */
export function flowJumpToTrail(index) {
  flowTrail.update(t => {
    flowRoot.set(t[index]);
    flowDepth.set(1);
    flowFeatureFilter.set(null);
    syncDetailToSymbol(t[index]);
    return t.slice(0, index);
  });
}

// Toggles which Features/<name> group of the root's direct children is
// shown in the flow diagram — click the same group again to clear back to
// showing all children.
export function setFlowFeatureFilter(name) {
  flowFeatureFilter.update(cur => cur === name ? null : name);
}

// Switches Calls/Called-by direction for the current root — the children
// set is entirely different, so any active feature filter no longer applies.
export function setFlowDirection(dir) {
  flowDirection.set(dir);
  flowFeatureFilter.set(null);
}

// Enumerates every path through `symId` in BOTH directions (callers + callees)
// using the active package focus as a subtree filter, then swaps the view to
// 'allFlows'. Heavy call hubs (TokenCacheService::set = 1500 callers) hit
// `maxPaths` immediately and the truncated flag tells the UI to surface that.
export function openAllFlows(symId) {
  const caps = get(allFlowsCaps);
  const allowedPkgs = get(packageFilter);
  const filterEdge = (edges) => allowedPkgs
    ? edges.filter(([otherId]) => allowedPkgs.has(DATA.files[DATA.symbols[otherId][4]][1]))
    : edges;
  const filterAdj = (adj) => {
    if (!allowedPkgs) return adj;
    const next = new Map();
    for (const [k, v] of adj) next.set(k, filterEdge(v));
    return next;
  };
  const inAdj = filterAdj(symInAdj);
  const outAdj = filterAdj(symOutAdj);
  const callerPaths = enumerateAllPaths(inAdj, symId, caps);
  const calleePaths = enumerateAllPaths(outAdj, symId, caps);
  allFlowsRoot.set(symId);
  allFlowsCallerPaths.set(callerPaths);
  allFlowsCalleePaths.set(calleePaths);
  allFlowsTruncated.set({
    callers: callerPaths.length >= caps.maxPaths,
    callees: calleePaths.length >= caps.maxPaths,
  });
  view.set('allFlows');
  selectedSymbol.set(symId);
  selectedFile.set(DATA.symbols[symId][4]);
}

// Re-runs enumeration with the current caps (e.g. user bumped maxPaths).
export function recomputeAllFlows() {
  const symId = get(allFlowsRoot);
  if (symId !== null) openAllFlows(symId);
}

// ---------- package focus ----------
// Plain click: focus on just this one package (toggle off if it's already
// the sole focus). Shift-click: add/remove this package from a multi-focus
// set, so "frontend + shared" is reachable without losing single-focus as
// the common one-click case.
export function togglePackageFocus(pkgIdx, additive = false) {
  packageFilter.update(cur => {
    if (!additive) {
      return (cur && cur.size === 1 && cur.has(pkgIdx)) ? null : new Set([pkgIdx]);
    }
    const next = new Set(cur || []);
    if (next.has(pkgIdx)) next.delete(pkgIdx); else next.add(pkgIdx);
    return next.size === 0 ? null : next;
  });
}

/** Removes any active package focus, restoring the unfiltered graph. */
export function clearPackageFocus() {
  packageFilter.set(null);
}
