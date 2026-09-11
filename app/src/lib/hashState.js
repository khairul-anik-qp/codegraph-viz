// Persists a slice of the app state to window.location.hash so a view
// (e.g. an all-flows enumeration of a specific symbol) is shareable as a
// URL. The hash format is plain query-string-style — readable, no JSON parse
// surprises, no URIComponent ambiguity for our small value space:
//   #view=flow&root=1234&dir=out&pkg=0,2&kind=class,function&q=auth
//
// Browser history is used for back-navigation: every time the *view* changes
// (view / pkg / root / aroot / sym / dir / depth), we pushState a new entry,
// so the OS-level back button and our in-app Back button both just call
// history.back() and a popstate listener restores the prior state. Minor
// updates (typing in search, toggling a kind chip, package focus) only
// replaceState the current entry — typing every character into the URL
// would be awful UX and pollute the back stack.

import { get } from 'svelte/store';
import {
  view, currentPkg, flowRoot, allFlowsRoot, selectedSymbol,
  searchQuery, packageFilter, symbolKindFilter, flowDirection, flowDepth,
} from './stores.js';

const STORE_IDS = new Set([
  'view', 'pkg', 'root', 'aroot', 'sym',
  'dir', 'depth', 'q', 'pkgs', 'kinds',
]);
const VIEW_KEY_PARTS = ['view', 'pkg', 'root', 'aroot', 'sym', 'dir', 'depth'];

function readHash() {
  const h = window.location.hash.replace(/^#/, '');
  const out = {};
  if (!h) return out;
  for (const part of h.split('&')) {
    if (!part) continue;
    const [k, v = ''] = part.split('=');
    if (STORE_IDS.has(k)) out[k] = decodeURIComponent(v);
  }
  return out;
}

function buildHash(obj) {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === '' || v == null) continue;
    parts.push(`${k}=${encodeURIComponent(v)}`);
  }
  return '#' + parts.join('&');
}

// Returns the subset of `obj` that identifies the *view* — used to detect
// when the user has navigated somewhere new (pushState) vs tweaked within
// the same view (replaceState). Hash form so string compare works.
function viewKeyOf(obj) {
  const sub = {};
  for (const k of VIEW_KEY_PARTS) if (obj[k] != null) sub[k] = obj[k];
  return buildHash(sub).replace(/^#/, '');
}

function collect() {
  const out = {};
  const v = get(view);
  out.view = v;
  if (v === 'files' && get(currentPkg) !== null) out.pkg = String(get(currentPkg));
  if (v === 'flow') {
    if (get(flowRoot) !== null) out.root = String(get(flowRoot));
    out.dir = get(flowDirection);
    out.depth = String(get(flowDepth));
  }
  if (v === 'allFlows' && get(allFlowsRoot) !== null) out.aroot = String(get(allFlowsRoot));
  if (get(selectedSymbol) !== null) out.sym = String(get(selectedSymbol));
  const q = get(searchQuery);
  if (q) out.q = q;
  const pkgs = get(packageFilter);
  if (pkgs) out.pkgs = [...pkgs].join(',');
  const kinds = get(symbolKindFilter);
  if (kinds) out.kinds = [...kinds].join(',');
  return out;
}

let installed = false;
let lastViewKey = '';
let suppressHashWrite = false; // set while we're restoring from popstate

function writeHash(obj) {
  const newHash = buildHash(obj);
  if (window.location.hash === newHash) return;
  const newViewKey = viewKeyOf(obj);
  if (newViewKey !== lastViewKey && lastViewKey !== '') {
    // Real navigation — push a new history entry so Back works.
    history.pushState(null, '', window.location.pathname + window.location.search + newHash);
  } else {
    history.replaceState(null, '', window.location.pathname + window.location.search + newHash);
  }
  lastViewKey = newViewKey;
}

let pendingHashUpdate = null;
function scheduleHashUpdate() {
  if (suppressHashWrite) return;
  if (pendingHashUpdate) return;
  pendingHashUpdate = setTimeout(() => {
    pendingHashUpdate = null;
    writeHash(collect());
  }, 200);
}

function applyFromHash(h) {
  suppressHashWrite = true;
  try {
    if (h.view) view.set(h.view);
    if (h.pkg != null) currentPkg.set(Number(h.pkg));
    if (h.root != null) flowRoot.set(Number(h.root));
    if (h.aroot != null) allFlowsRoot.set(Number(h.aroot));
    if (h.sym != null) selectedSymbol.set(Number(h.sym));
    if (h.dir) flowDirection.set(h.dir);
    if (h.depth) flowDepth.set(Number(h.depth));
    if (h.q) searchQuery.set(h.q);
    if (h.pkgs) packageFilter.set(new Set(h.pkgs.split(',').map(Number)));
    if (h.kinds) symbolKindFilter.set(new Set(h.kinds.split(',')));
  } finally {
    suppressHashWrite = false;
  }
}

export function applyHashState() {
  if (installed) return;
  installed = true;

  const h = readHash();
  applyFromHash(h);
  lastViewKey = viewKeyOf({ ...collect(), ...h });

  const unsubs = [
    view.subscribe(scheduleHashUpdate),
    currentPkg.subscribe(scheduleHashUpdate),
    flowRoot.subscribe(scheduleHashUpdate),
    allFlowsRoot.subscribe(scheduleHashUpdate),
    selectedSymbol.subscribe(scheduleHashUpdate),
    flowDirection.subscribe(scheduleHashUpdate),
    flowDepth.subscribe(scheduleHashUpdate),
    searchQuery.subscribe(scheduleHashUpdate),
    packageFilter.subscribe(scheduleHashUpdate),
    symbolKindFilter.subscribe(scheduleHashUpdate),
  ];

  // Listen for browser back/forward. The URL hash already encodes the state;
  // just re-apply it to the stores. The scheduleHashUpdate subscription is
  // suppressed for the duration so we don't push a duplicate entry.
  const onPopState = () => {
    const h2 = readHash();
    applyFromHash(h2);
    lastViewKey = viewKeyOf(h2);
  };
  window.addEventListener('popstate', onPopState);

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      unsubs.forEach(u => u());
      window.removeEventListener('popstate', onPopState);
      installed = false;
    });
  }
}

// In-app Back button — delegates to the browser so OS-level back (Alt+←)
// and the button stay in sync. Falls back to packages view when there's
// nothing to go back to (very first visit).
export function goBack() {
  if (history.length > 1) {
    history.back();
  } else {
    view.set('packages');
  }
}

export function syncHash() {
  if (installed) writeHash(collect());
}