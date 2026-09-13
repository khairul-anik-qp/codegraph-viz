// Pure graph helpers — framework-agnostic, shared by PackageView and FileView.

/** Fixed color palette used to distinguish packages consistently across views. */
export const PKG_COLORS = ['#5b5ed6', '#d97b3f', '#3fa77f', '#c94f7c', '#4a90d9', '#a367c9', '#c9a13f', '#7d8590'];

/** Picks a stable display color for a package by index, cycling through the palette. */
export function pkgColor(i) {
  return PKG_COLORS[i % PKG_COLORS.length];
}

/** Shortens a package name to its final path segment for compact display. */
export function shortPkg(name) {
  return name.split('/').pop();
}

// "index.tsx" tells you nothing on a graph node — use the parent folder name
// instead, since that's what actually names the component/module in this
// codebase's convention (ComponentName/index.tsx).
export function displayName(filePath) {
  const parts = filePath.split('/');
  const base = parts[parts.length - 1];
  const stem = base.replace(/\.(tsx?|jsx?|vue|svelte)$/, '');
  if (stem === 'index' && parts.length > 1) return parts[parts.length - 2];
  return base;
}

// This codebase composes Screens out of Features/<FeatureName>/ folders
// (per the repo's EQC conventions) — that folder name is the natural label
// for "which flow" a file belongs to when fanning out from a Screen or a
// large component. Returns null when the path has no Features/ segment
// (e.g. plain utils, backend code), which callers bucket as "Other".
export function featureGroup(filePath) {
  const parts = filePath.split('/');
  const idx = parts.indexOf('Features');
  if (idx === -1 || idx + 1 >= parts.length) return null;
  return parts[idx + 1];
}

/**
 * DATA shape (produced by generate.mjs):
 *   packages: [name, fileCount, symbolCount][]
 *   packageEdges: [srcPkgIdx, tgtPkgIdx, importWeight, callWeight][]
 *   files: [path, pkgIdx, language, nodeCount, modifiedAt, indexedAt, errors][]
 *     (modifiedAt/indexedAt are epoch ms; modifiedAt > indexedAt means the
 *     source changed after this file was last indexed — the graph may be
 *     stale for it; errors is whatever CodeGraph's indexer recorded for this
 *     file, e.g. an unrecoverable parse error — [] when clean)
 *   fileEdges: [srcFileIdx, tgtFileIdx, kindCode(0=imports,1=calls), weight][]
 *   symbols: [name, kind, startLine, isExported, fileIdx, snippet, doc,
 *     signature, returnType, visibility, isAsync, isStatic, qualifiedName,
 *     isAbstract, decorators, typeParameters][] (global id = array index;
 *     doc = docstring, '' if none; signature/returnType/visibility/
 *     qualifiedName/decorators/typeParameters are CodeGraph's own parsed
 *     fields — '' or [] when the language doesn't carry one; qualifiedName
 *     is '' when identical to name; isAsync/isStatic/isAbstract are 0|1)
 *   projectMetadata: {[key]: value} — free-form bag CodeGraph's indexer
 *     writes about itself (index_state, tool/extraction versions, files
 *     discovered/accounted for, etc)
 *   fileSymbolIds: per-file-index array of global symbol ids belonging to that file
 *   symbolEdges: [srcSymId, tgtSymId, weight, callLines][] (calls only;
 *     callLines is the sorted list of absolute source-file line numbers
 *     where srcSymId calls tgtSymId — usually one entry, more if called
 *     from multiple spots in the same function body)
 *   symbolUsageEdges: [srcSymId, tgtSymId, kindCode, weight][] — everything
 *     that reaches a symbol WITHOUT calling it. kindCode: 0=references
 *     (type/constant/property use), 1=extends, 2=implements,
 *     3=instantiates (`new X()`). Used for accurate "is this reachable at
 *     all" checks (dead-code) and for the class-hierarchy/constructs views.
 *   unresolvedImports: [fileIdx, importedName, line][] — import specifiers
 *     that look internal (relative, or `@/`-style alias) but never
 *     resolved to a real file. Excludes external packages/builtins and
 *     non-import unresolved refs (test-framework globals etc), which
 *     dominate CodeGraph's raw unresolved_refs table and aren't actionable.
 */
/** Builds outgoing and incoming adjacency maps from a flat edge list for fast graph traversal. */
export function buildAdjacency(edges) {
  const out = new Map();
  const inn = new Map();
  edges.forEach((edge) => {
    const [s, t] = edge;
    const rest = edge.slice(2);
    if (!out.has(s)) out.set(s, []);
    if (!inn.has(t)) inn.set(t, []);
    out.get(s).push([t, ...rest]);
    inn.get(t).push([s, ...rest]);
  });
  return { out, inn };
}

/** Lists the indices of every file belonging to a given package. */
export function filesInPkg(files, pkgIdx) {
  const arr = [];
  files.forEach((f, i) => { if (f[1] === pkgIdx) arr.push(i); });
  return arr;
}

// Groups package indices into coarse "domains" by truncating each package's
// `/`-separated path to `depth` segments. E.g. at depth 2, `app/src/lib` and
// `app/src/components` both truncate to `app/src` and group together. A
// package with fewer than `depth` segments groups under its own full name
// (truncation is a no-op once you run out of segments).
export function groupPackagesByDepth(packages, depth) {
  const groups = new Map();
  packages.forEach(([name], i) => {
    const prefix = name.split('/').slice(0, depth).join('/');
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(i);
  });
  return groups;
}

const FLOW_MAX_CHILDREN = 12;

// Builds a single-flow tree rooted at symId, walking `adjacency` (symOutAdj
// for "what this calls", symInAdj for "who calls this") up to maxDepth hops.
// Cycles (recursive/mutually-recursive calls) are cut per-branch — a symbol
// already on the current path renders as a leaf marked `cyclic` instead of
// recursing forever. Hub functions with huge fan-out are capped per node
// with a `moreCount` marker rather than rendering hundreds of siblings.
// `allowedPkgs` (Set of package indices, or null for no restriction) prunes
// the whole subtree to one package focus — e.g. hide backend/playwright
// noise when tracing a frontend-only flow. The root itself is always kept
// even if outside the filter, since you searched for it on purpose.
export function buildFlowTree(symbols, files, adjacency, symId, maxDepth, allowedPkgs = null) {
  function nodeInfo(id) {
    const s = symbols[id];
    return { id, name: s[0], kind: s[1], filePath: files[s[4]][0], pkgIdx: files[s[4]][1], doc: s[6] || '' };
  }
  function build(id, depth, ancestors) {
    const node = { ...nodeInfo(id), children: [], moreCount: 0 };
    if (depth >= maxDepth) {
      node.truncated = (adjacency.get(id) || []).length > 0;
      return node;
    }
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(id);
    let edges = (adjacency.get(id) || []).slice().sort((a, b) => b[1] - a[1]);
    if (allowedPkgs) {
      edges = edges.filter(([otherId]) => allowedPkgs.has(files[symbols[otherId][4]][1]));
    }
    const shown = edges.slice(0, FLOW_MAX_CHILDREN);
    node.moreCount = Math.max(0, edges.length - shown.length);
    for (const [otherId] of shown) {
      if (ancestors.has(otherId)) {
        node.children.push({ ...nodeInfo(otherId), children: [], moreCount: 0, cyclic: true });
      } else {
        node.children.push(build(otherId, depth + 1, nextAncestors));
      }
    }
    return node;
  }
  return build(symId, 0, new Set());
}

// Enumerates every distinct path through `rootId` along `adjacency` (use
// symOutAdj for downstream callees, symInAdj for upstream callers), up to
// `maxDepth` hops. Returns symId[][]. Each returned path is the sequence of
// nodes from the root to a leaf in the chosen direction. Cycles are cut
// per-branch (a node already on the current path isn't re-entered, so a
// recursive function shows once at its first appearance and stops there).
// Per-node fan-out is capped at `maxChildren` (sorted by edge weight desc
// to prefer strong call sites); if a node has more children than that, the
// rest are dropped — better to under-show than to freeze on a hub function.
// `maxPaths` is a hard global ceiling across all branches; once hit, walk
// stops. Both caps exist because 'enumerate all paths through X' on a real
// call graph is exponential in branching.
export function enumerateAllPaths(adjacency, rootId, {
  maxDepth = 5,
  maxPaths = 500,
  maxChildren = 8,
} = {}) {
  const paths = [];
  function walk(id, ancestors, current) {
    if (paths.length >= maxPaths) return;
    const edges = (adjacency.get(id) || []).slice().sort((a, b) => b[1] - a[1]);
    const kept = edges.slice(0, maxChildren);
    if (kept.length === 0 || current.length - 1 >= maxDepth) {
      paths.push(current.slice());
      return;
    }
    let extended = false;
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(id);
    for (const [otherId] of kept) {
      if (paths.length >= maxPaths) return;
      if (ancestors.has(otherId)) continue;
      current.push(otherId);
      extended = true;
      walk(otherId, nextAncestors, current);
      current.pop();
    }
    if (!extended) paths.push(current.slice());
  }
  walk(rootId, new Set(), [rootId]);
  return paths;
}

/** Finds every node reachable within a hop limit from a starting node, for isolate-mode graph views. */
export function bfs(startIdx, outAdj, inAdj, hopLimit, direction) {
  const visible = new Set([startIdx]);
  let frontier = [startIdx];
  let depth = 0;
  while (frontier.length && depth < hopLimit) {
    const next = [];
    for (const node of frontier) {
      if (direction === 'out' || direction === 'both') {
        for (const edge of (outAdj.get(node) || [])) {
          if (!visible.has(edge[0])) { visible.add(edge[0]); next.push(edge[0]); }
        }
      }
      if (direction === 'in' || direction === 'both') {
        for (const edge of (inAdj.get(node) || [])) {
          if (!visible.has(edge[0])) { visible.add(edge[0]); next.push(edge[0]); }
        }
      }
    }
    frontier = next;
    depth++;
  }
  return visible;
}

// Symbols that are not exported AND unreached — strong dead-code candidates
// (un-exported, so nothing outside the file can reach them, and nothing
// inside the file reaches them either). Exported symbols may also be dead
// if unreferenced, but we can't be sure (entry points, framework callbacks,
// etc) — flag them separately.
//
// "Reached" means either a `calls` edge (symInAdj) OR any symbolUsageEdges
// entry (symUsageInAdj) — references, extends, implements, instantiates.
// Using `calls` alone (the old behavior) meant every interface, type alias,
// constant and enum — none of which are ever "called" — read as dead
// regardless of how heavily they're actually used, which on a real
// codebase flags the vast majority of symbols and makes the view useless.
export function findDeadCode(symbols, symInAdj, symUsageInAdj) {
  const dead = [];
  for (let i = 0; i < symbols.length; i++) {
    const s = symbols[i];
    const isExported = !!s[3];
    const callers = symInAdj.get(i) || [];
    const usages = symUsageInAdj.get(i) || [];
    if (callers.length === 0 && usages.length === 0) {
      dead.push({ symId: i, kind: s[1], name: s[0], exported: isExported });
    }
  }
  return dead;
}

// USAGE_KIND codes, matching bin/codegraph-viz.js's USAGE_KIND_CODE.
export const USAGE_REFERENCES = 0;
export const USAGE_EXTENDS = 1;
export const USAGE_IMPLEMENTS = 2;
export const USAGE_INSTANTIATES = 3;

// Groups extends/implements edges into parent -> [children] entries for a
// class-hierarchy view. `symUsageInAdj` maps a symId to its incoming usage
// edges; for a parent class P, the incoming extends/implements edges ARE
// its subclasses/implementors (edge is [child, parent, kind] so it lands in
// symUsageInAdj.get(parentId)). Returns one entry per distinct parent that
// has at least one child, sorted by child count desc. A class can appear
// as both a parent (in one entry) and a child (listed under its own
// parent's entry) — multi-level chains aren't collapsed into a single tree,
// which keeps this simple for the common (mostly single-inheritance) case.
export function classHierarchy(symbols, symUsageInAdj) {
  const out = [];
  for (const [parentId, edges] of symUsageInAdj) {
    const children = edges
      .filter(([, kind]) => kind === USAGE_EXTENDS || kind === USAGE_IMPLEMENTS)
      .map(([childId, kind]) => ({ symId: childId, name: symbols[childId][0], kind: symbols[childId][1], via: kind === USAGE_EXTENDS ? 'extends' : 'implements' }));
    if (children.length === 0) continue;
    const s = symbols[parentId];
    out.push({ symId: parentId, name: s[0], kind: s[1], children: children.sort((a, b) => a.name.localeCompare(b.name)) });
  }
  return out.sort((a, b) => b.children.length - a.children.length);
}

// Groups instantiates edges into target -> [constructors] entries — "what
// gets `new`'d, and from where". Same edge-direction logic as
// classHierarchy: incoming instantiates edges on the constructed class are
// its construction sites.
export function topInstantiated(symbols, symUsageInAdj) {
  const out = [];
  for (const [targetId, edges] of symUsageInAdj) {
    const sites = edges
      .filter(([, kind]) => kind === USAGE_INSTANTIATES)
      .map(([srcId, , w]) => ({ symId: srcId, name: symbols[srcId][0], kind: symbols[srcId][1], count: w }));
    if (sites.length === 0) continue;
    const s = symbols[targetId];
    const total = sites.reduce((acc, s2) => acc + s2.count, 0);
    out.push({ symId: targetId, name: s[0], kind: s[1], total, sites: sites.sort((a, b) => b.count - a.count) });
  }
  return out.sort((a, b) => b.total - a.total);
}

// Tarjan's strongly-connected-components algorithm on the directed call
// graph (use symOutAdj for 'caller → callee' direction). Returns an array of
// SCCs, each an array of symIds. SCCs with size > 1 are call cycles; size-1
// SCCs appear only when a node has no outgoing edges AND no incoming edges
// (isolated) — we filter those out since they're not "cycles" in any useful
// sense. Returns a Map<symId, sccIndex> for fast lookup when tagging paths.
export function findCycles(symOutAdj) {
  let index = 0;
  const stack = [];
  const onStack = new Set();
  const indices = new Map();
  const lowlinks = new Map();
  const sccs = [];

  function strongconnect(v) {
    indices.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    const out = symOutAdj.get(v) || [];
    for (const [w] of out) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v), lowlinks.get(w)));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v), indices.get(w)));
      }
    }
    if (lowlinks.get(v) === indices.get(v)) {
      const scc = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc);
    }
  }

  for (const v of symOutAdj.keys()) {
    if (!indices.has(v)) strongconnect(v);
  }
  const map = new Map();
  sccs.forEach((scc, i) => {
    if (scc.length < 2) return;
    for (const v of scc) map.set(v, i);
  });
  return { sccs: sccs.filter(s => s.length > 1), map };
}

// Cheap cyclomatic-complexity approximation: count branching constructs in a
// snippet. Real cyclomatic complexity needs an AST (each `if`, `for`, `while`,
// `case`, `catch`, `&&`, `||`, `?:` adds a path). Without tree-sitter at
// runtime we approximate via regex — accurate enough to rank functions by
// complexity for refactor targeting. Not meaningful for one-liners or DSLs.
export function complexity(snippet) {
  if (!snippet) return 0;
  let n = 1;
  const re = /\b(if|else if|for|while|catch|case)\b|\&\&|\|\||\?[^a-zA-Z0-9_]/g;
  while (re.exec(snippet)) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Signature / props parsing
// ---------------------------------------------------------------------------
// Regex on the first meaningful line of a snippet. Designed to cover the
// common shapes in real codebases — TS/JS function/arrow/method, Python
// def, Go func, Rust fn, plus TS interface/type bodies. Not a full parser:
// when the regex fails we return { raw } so the UI can fall back to showing
// the raw first line. Truth is in the source — this is best-effort.

/** Finds the first non-blank, non-comment line of a snippet, used as the basis for signature parsing. */
function firstMeaningfulLine(snippet) {
  if (!snippet) return null;
  for (const raw of snippet.split('\n')) {
    const t = raw.trim();
    if (!t) continue;
    if (t.startsWith('//') || t.startsWith('#') || t.startsWith('--')) continue;
    if (t.startsWith('/*') && t.endsWith('*/') && t.length > 4) continue;
    if (t.startsWith('"""') || t.startsWith("'''")) continue;
    if (t.startsWith('*')) continue; // mid-block-comment line
    return t;
  }
  return null;
}

// Find a balanced pair of brackets starting at `openIdx` (which must point
// to the open char). Respects string literals and nested brackets. Returns
// the slice between the brackets, or null if unbalanced.
function balancedSlice(str, openIdx) {
  const open = str[openIdx];
  const close = { '(': ')', '<': '>', '[': ']', '{': '}' }[open];
  if (!close) return null;
  let depth = 0;
  let inStr = null;
  for (let i = openIdx; i < str.length; i++) {
    const c = str[i];
    if (inStr) {
      if (c === inStr && str[i - 1] !== '\\') inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '/' && str[i + 1] === '/') { while (i < str.length && str[i] !== '\n') i++; i--; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return str.slice(openIdx + 1, i); }
  }
  return null;
}

// Split a string by `sep` at the top level only (respects brackets + strings).
function splitTopLevel(str, sep) {
  const out = [];
  let depth = 0;
  let inStr = null;
  let cur = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (inStr) {
      cur += c;
      if (c === inStr && str[i - 1] !== '\\') inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; cur += c; continue; }
    if (c === '(' || c === '<' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === '>' || c === ']' || c === '}') depth--;
    if (c === sep && depth === 0) { out.push(cur); cur = ''; }
    else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

// Extract generics `<T>`, `<T extends X>`, `<T, U>` from a string. Returns
// the inner content or null. Picks the first `<...>` that has a matching
// `>` at the top level (so `Array<T>` matches but `a<b` doesn't).
function extractGenerics(str) {
  const idx = str.indexOf('<');
  if (idx === -1) return null;
  let depth = 0;
  for (let i = idx; i < str.length; i++) {
    const c = str[i];
    if (c === '<') depth++;
    else if (c === '>') { depth--; if (depth === 0) return str.slice(idx + 1, i).trim(); }
  }
  return null;
}

// Parse a single param string like `name: T`, `name?: T = 'def'`, `...rest: T[]`,
// `name = 'def'`, or just `name`. Returns null on total miss.
function parseParam(raw) {
  const p = raw.trim();
  if (!p) return null;
  // Destructured/object pattern: `{ a, b }: T` or `{ a, b }` — keep the whole
  // thing as the type cell, no name to surface.
  if (p.startsWith('{') || p.startsWith('[')) {
    const colon = findTopLevelColon(p);
    if (colon !== -1) {
      return { name: null, type: p.slice(colon + 1).trim() || null, optional: false, default: null, isRest: false };
    }
    return { name: null, type: p, optional: false, default: null, isRest: false };
  }
  // Rest: ...name: T
  const rest = p.match(/^(\.\.\.)\s*(\w+)\s*(?::\s*(.+?))?(?:\s*=\s*(.+))?$/);
  if (rest) {
    return { name: rest[2], type: rest[3]?.trim() || null, optional: false, default: rest[4]?.trim() || null, isRest: true };
  }
  // Typed: name?: T = default, or name: T
  const typed = p.match(/^(\w+)\s*(\?)?\s*:\s*(.+?)(?:\s*=\s*(.+))?$/);
  if (typed) {
    return { name: typed[1], type: typed[3].trim(), optional: !!typed[2], default: typed[4]?.trim() || null, isRest: false };
  }
  // Untyped: name = default, or name?
  const untyped = p.match(/^(\w+)\s*(\?)?\s*(?:=\s*(.+))?$/);
  if (untyped) {
    return { name: untyped[1], type: null, optional: !!untyped[2], default: untyped[3]?.trim() || null, isRest: false };
  }
  return null;
}

/** Finds the index of a colon at bracket/string nesting depth zero, for splitting a name from its type. */
function findTopLevelColon(str) {
  let depth = 0;
  let inStr = null;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (inStr) { if (c === inStr && str[i - 1] !== '\\') inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '(' || c === '<' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === '>' || c === ']' || c === '}') depth--;
    if (c === ':' && depth === 0) return i;
  }
  return -1;
}

// Parse a single Go-style param `name string`, `*Request`, `name *Request`.
// Go types can have leading `*`/`[]`/`...`/map prefixes — capture the type
// as the longest token that isn't a simple identifier.
function parseGoParam(raw) {
  const p = raw.trim();
  if (!p) return null;
  // name ...type, name type, name *type, name []type, name map[K]V
  const m = p.match(/^(\w+)\s+(.+)$/);
  if (m) return { name: m[1], type: m[2].trim(), optional: false, default: null, isRest: false };
  // Type-only (no name) — variadic or unnamed
  return { name: null, type: p, optional: false, default: null, isRest: false };
}

// Parse a callable signature from a snippet's first line. Returns:
//   { raw, name?, params: [{name, type, optional, default, isRest}], returns, generics, isAsync, isStatic }
// or `null` when the line doesn't look callable.
export function parseSignature(snippet) {
  const line = firstMeaningfulLine(snippet);
  if (!line) return null;

  // Detect flags from the original line BEFORE we strip modifiers — the
  // strip removes `async` from TS, `async` from Rust, etc.
  const isAsync = /\basync\b/.test(line);
  const isStatic = /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:public\s+|private\s+|protected\s+|readonly\s+|static\s+|override\s+)+\w/.test(line);

  // Strip decorators, then leading modifiers.
  let s = line.replace(/^@\w+(?:\([^)]*\))?\s+/, '');
  s = s.replace(/^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:public\s+|private\s+|protected\s+|readonly\s+|static\s+|override\s+)*/, '');

  // Try Python first (cheap reject on "def" prefix).
  const pyMatch = s.match(/^def\s+(\w+)\s*(<[^>]+>)?\s*\(([^)]*)\)\s*(?:->\s*([^:]+?))?\s*:/);
  if (pyMatch) {
    return {
      raw: line, name: pyMatch[1], generics: pyMatch[2] ? pyMatch[2].slice(1, -1).trim() : null,
      params: splitTopLevel(pyMatch[3], ',').map(parseParam).filter(Boolean),
      returns: pyMatch[4]?.trim() || null, isAsync, isStatic: false,
    };
  }

  // Go: func name[T](p1 T1, p2 *T2) (R, error) { or func (r *Recv) name(...)
  const goMatch = s.match(/^func\s+(?:\([^)]*\)\s+)?(\w+)\s*(<[^>]+>)?\s*\(([^)]*)\)\s*(.*)$/);
  if (goMatch) {
    const tail = goMatch[4].trim();
    const ret = tail.startsWith('{') || !tail ? null : tail.replace(/\s*\{.*$/, '').trim() || null;
    return {
      raw: line, name: goMatch[1], generics: goMatch[2] ? goMatch[2].slice(1, -1).trim() : null,
      params: splitTopLevel(goMatch[3], ',').map(parseGoParam).filter(Boolean),
      returns: ret, isAsync: false, isStatic: false,
    };
  }

  // Rust: pub fn name<T>(p1: &T1) -> Result<R, E> {
  const rustMatch = s.match(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+|const\s+|unsafe\s+|extern\s+(?:"[^"]+"\s+)?)?fn\s+(\w+)\s*(<[^>]+>)?\s*\(([^)]*)\)\s*(?:->\s*(.+?))?(?:\s*\{|;|$)/);
  if (rustMatch) {
    return {
      raw: line, name: rustMatch[1], generics: rustMatch[2] ? rustMatch[2].slice(1, -1).trim() : null,
      params: splitTopLevel(rustMatch[3], ',').map(parseParam).filter(Boolean),
      returns: rustMatch[4]?.trim() || null, isAsync, isStatic: false,
    };
  }

  // TS/JS: find the parens that follow the name (could be method, function, arrow, class).
  const parenIdx = s.indexOf('(');
  if (parenIdx === -1) return { raw: line, params: [], returns: null, generics: null, isAsync, isStatic: false };

  // Generics can appear before the parens (function name<T>(...) or method name<T>(...))
  const pre = s.slice(0, parenIdx);
  const generics = extractGenerics(pre);
  // Strip the generic from `pre` so name extraction doesn't get confused by
  // the trailing `>` (e.g. `function foo<T>` → pre ends with `>`).
  const preNoGen = generics ? pre.replace(new RegExp(`<[^<>]*(?:<(?:[^<>]|<[^<>]*>)*>[^<>]*)*>`), '').trim() : pre;
  const nameMatch = preNoGen.match(/(\w+)\s*(?:=\s*)?$/);
  const name = nameMatch ? nameMatch[1] : null;

  const inner = balancedSlice(s, parenIdx);
  if (inner === null) return null;

  const params = splitTopLevel(inner, ',').map(parseParam).filter(Boolean);

  // Returns: look for `: T` after the closing paren, before `{`/`=>`/end.
  const after = s.slice(parenIdx + inner.length + 2).trim();
  let returns = null;
  const retColon = after.match(/^:\s*(.+?)(?:\s*=>|\s*\{|;|$)/);
  if (retColon) returns = retColon[1].trim().replace(/\s*=>\s*$/, '');

  return { raw: line, name, generics, params, returns, isAsync, isStatic };
}

// Parse a TS interface / type-alias body for member names + types. Handles:
//   interface X<T> { a: T1; b?: T2; c(p1: P1): R }
//   type X<T> = { a: T1; b?: T2 }
//   interface X { [k: string]: V }
// Returns { members, generics } or null.
/** Parses a TS interface/type-alias snippet into its member names and types for display. */
export function parseTypeBody(snippet) {
  if (!snippet) return null;
  const m = snippet.match(/\b(?:interface|type)\s+\w+/);
  if (!m) return null;
  // Generics: between the name and the body opener.
  const tail = snippet.slice(m.index + m[0].length);
  const genericsMatch = tail.match(/^\s*(<[^>]+>)?/);
  const generics = genericsMatch && genericsMatch[1] ? genericsMatch[1].slice(1, -1).trim() : null;
  // Find body start. For `type X = {...}` it's `=`; for `interface X {...}` it's directly `{`.
  const bodyStart = snippet.indexOf('{', m.index);
  if (bodyStart === -1) return null;
  const bodyEnd = (() => {
    let depth = 0;
    for (let i = bodyStart; i < snippet.length; i++) {
      if (snippet[i] === '{') depth++;
      else if (snippet[i] === '}') { depth--; if (depth === 0) return i; }
    }
    return -1;
  })();
  if (bodyEnd === -1) return { members: [], generics };
  const body = snippet.slice(bodyStart + 1, bodyEnd);
  const members = [];
  for (const raw of body.split(/[;\n}]/)) {
    const line = raw.trim();
    if (!line) continue;
    // Method shorthand: name(params): R or name?(params): R
    const method = line.match(/^(\w+)\s*(\?)?\s*\(([^)]*)\)\s*:\s*(.+)$/);
    if (method) {
      members.push({ name: method[1], type: `(${method[3]}) => ${method[4].trim()}`, optional: !!method[2], isMethod: true });
      continue;
    }
    // Index signature: [k: string]: V
    const idx = line.match(/^\[\s*([^\]]+)\s*\]\s*:\s*(.+)$/);
    if (idx) {
      members.push({ name: `[${idx[1]}]`, type: idx[2].trim(), optional: false, isIndex: true });
      continue;
    }
    // Field: name?: T = default, or name: T
    const field = line.match(/^(\w+)(\?)?\s*:\s*(.+?)(?:\s*=\s*.+)?$/);
    if (field) {
      members.push({ name: field[1], type: field[3].trim(), optional: !!field[2], isMethod: false });
      continue;
    }
  }
  return { members, generics };
}

// Convention-based test-file detection. Covers the major naming conventions
// across languages — TypeScript/Jest, Python/pytest, Go, Ruby/RSpec, Rust,
// Java/JUnit, etc. Returns true if any token in the path matches.
const TEST_PATH_TOKENS = [
  /\.test\./, /\.spec\./, /\.unit\./, /\.integration\./,
  /\/__tests__\//, /\/tests?\//, /\/test\//, /\/spec\//, /\/specs\//,
  /_test\.go$/, /_test\.py$/, /test_[^/]+\.py$/,
  /Test\.java$/, /Tests\.java$/, /Test\.kt$/, /Tests\.kt$/,
  /_spec\.rb$/, /_test\.rs$/,
];
export function isTestFile(filePath) {
  return TEST_PATH_TOKENS.some(re => re.test(filePath));
}

// Given a symbol, returns the set of test-file symbols that reach it
// (directly or transitively) via inbound call edges. "This function is
// exercised by these tests" — the inverse of "what does this test cover".
// Bounded by `maxDepth` to avoid runaway expansion through shared helpers.
export function findRelatedTests(symId, symInAdj, files, symbols, maxDepth = 4) {
  const tests = new Set();
  const visited = new Set();
  const queue = [{ id: symId, depth: 0 }];
  while (queue.length) {
    const { id, depth } = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    if (depth > 0) {
      const fileIdx = symbols[id][4];
      if (isTestFile(files[fileIdx][0])) tests.add(id);
    }
    if (depth < maxDepth) {
      for (const [caller] of (symInAdj.get(id) || [])) {
        if (!visited.has(caller)) queue.push({ id: caller, depth: depth + 1 });
      }
    }
  }
  return [...tests];
}

// A short, deliberately LINEAR (not branching) greedy walk from `rootId`:
// repeatedly follows the FIRST outgoing edge in `symOutAdj.get(id)` (same
// adjacency shape buildAdjacency produces), stopping at `maxHops` steps, at
// a node with no outgoing edges, or upon revisiting an already-visited symId
// (cycle guard — belt-and-suspenders alongside the hop cap, which alone
// already bounds the walk). This is intentionally NOT buildFlowTree, which
// produces a full branching tree — this produces one flat preview path.
export function previewChain(rootId, symOutAdj, maxHops = 4) {
  const chain = [rootId];
  const visited = new Set([rootId]);
  let current = rootId;
  for (let i = 0; i < maxHops; i++) {
    const edges = symOutAdj.get(current);
    if (!edges || edges.length === 0) break;
    const next = edges[0][0];
    if (visited.has(next)) break;
    chain.push(next);
    visited.add(next);
    current = next;
  }
  return chain;
}

// Heuristic entry-point detection. An entry point is something the
// framework/runtime calls *into* your code — main, HTTP handlers, lifecycle
// hooks, CLI commands. Two signals, either one marks it:
//   1. Exported + zero callers (your public surface that nothing internal
//      invokes — likely wired by the framework at runtime).
//   2. Snippet contains a framework entry marker. The regex is intentionally
//      permissive — false positives are OK (you want to SEE candidates), false
//      negatives are not.
const ENTRY_MARKERS = /\b(app|router|server)\.(get|post|put|delete|patch|use)\b|@(Get|Post|Put|Delete|Patch|Controller|app\.route)\b|^export\s+default\s+function|def\s+main\s*\(|\bhandler\s*:\s*\(|onMount\s*\(|useEffect\s*\(|module\.exports\s*=|app\.listen\s*\(|process\.argv|exports\.(handler|main|start|run|init)/;
export function isEntryPoint(sym, snippet, callerCount) {
  if (sym[3] && callerCount === 0) return true; // exported + zero callers
  if (snippet && ENTRY_MARKERS.test(snippet)) return true;
  return false;
}

// Counts every symbol that can REACH `symId` through any call path
// (transitive inbound reach). The "kill this function and how much breaks"
// metric — much more meaningful for refactoring decisions than direct
// in-degree. Memoized so repeated renders don't recompute.
const reachCache = new Map();
export function transitiveReach(symId, symInAdj) {
  if (reachCache.has(symId)) return reachCache.get(symId);
  const visited = new Set();
  const stack = [symId];
  while (stack.length) {
    const id = stack.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    for (const [caller] of (symInAdj.get(id) || [])) {
      if (!visited.has(caller)) stack.push(caller);
    }
  }
  const reach = visited.size - 1; // exclude self
  reachCache.set(symId, reach);
  return reach;
}

// BFS shortest path between two arbitrary symbols, walking the call graph as
// UNDIRECTED (both symOutAdj and symInAdj neighbors) — a user picking two
// symbols in the Path Finder modal wants "how does A relate to B at all",
// not "does A call B" specifically. Returns the ordered symId chain
// (inclusive of both ends), or null if no path exists within the graph.
export function shortestPath(fromId, toId, symOutAdj, symInAdj) {
  if (fromId === toId) return [fromId];
  const prev = new Map([[fromId, null]]);
  const queue = [fromId];
  let qi = 0;
  while (qi < queue.length) {
    const id = queue[qi++];
    const neighbors = [
      ...(symOutAdj.get(id) || []).map(([n]) => n),
      ...(symInAdj.get(id) || []).map(([n]) => n),
    ];
    for (const next of neighbors) {
      if (prev.has(next)) continue;
      prev.set(next, id);
      if (next === toId) {
        const path = [toId];
        let cur = toId;
        while (prev.get(cur) !== null) {
          cur = prev.get(cur);
          path.push(cur);
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

// Every symbol that transitively depends on (transitively calls into) any of
// `changedSymIds` — walks symInAdj (callers) outward from each seed. Used by
// the diff/blast-radius overlay: "if these symbols changed, what else could
// break". Always includes the seeds themselves so the overlay can render
// "changed" vs "affected" as two subsets of the same set.
export function blastRadius(changedSymIds, symInAdj) {
  const visited = new Set(changedSymIds);
  const stack = [...changedSymIds];
  while (stack.length) {
    const id = stack.pop();
    for (const [caller] of (symInAdj.get(id) || [])) {
      if (!visited.has(caller)) {
        visited.add(caller);
        stack.push(caller);
      }
    }
  }
  return visited;
}

// Walk BACKWARD from `symId` through symInAdj and find the entry points
// (zero-callers exports + framework entry markers) that can reach it.
// For each, return the actual chain from entry to symId so the UI can
// render a breadcrumb.
//
// Two-phase:
//   1. BFS through symInAdj to find every symbol that can reach symId.
//   2. From each candidate entry point, walk forward along the BFS
//      tree we built in phase 1 to recover the shortest path to symId.
//
// Returns at most `maxPaths` entries, sorted shortest-first (the most
// direct chains are usually the most informative — "this was called
// from X, which was called from Y" is more useful than a 15-hop
// barely-related chain).
export function findEntryPathsToSymbol(symId, symInAdj, symbols, files, maxPaths = 20) {
  // Phase 1: BFS backward, recording each symbol's first predecessor
  // that led to symId. We only need one path per reachable symbol.
  const predecessor = new Map();
  predecessor.set(symId, null);
  const queue = [symId];
  while (queue.length) {
    const id = queue.shift();
    for (const [caller] of (symInAdj.get(id) || [])) {
      if (predecessor.has(caller)) continue;
      predecessor.set(caller, id);
      queue.push(caller);
    }
  }

  // Phase 2: find every entry point in the reachable set. "Entry" =
  // zero callers OR isEntryPoint(...) (exported + no callers, or
  // matches framework marker patterns). The reachable set is every key
  // in `predecessor` except symId itself.
  const results = [];
  for (const [id, prev] of predecessor) {
    if (id === symId) continue;
    const directCallers = symInAdj.get(id) || [];
    const isEntry = directCallers.length === 0;
    // Skip pure leaf nodes that aren't actually entry points (these
    // are reached by an entry point via a chain — they shouldn't be
    // shown as the "root"). They will appear as intermediates in the
    // breadcrumb of the true entry point.
    if (!isEntry) continue;

    // Reconstruct the chain from `id` to `symId` by following
    // predecessor links forward.
    const path = [id];
    let cur = id;
    while (cur !== symId) {
      const next = predecessor.get(cur);
      if (next == null) break;
      path.push(next);
      cur = next;
    }

    // For the breadcrumb: path is [entry, ..., symId]. Reverse so it
    // reads top-down.
    path.reverse();

    const entrySym = symbols[id];
    if (!entrySym) continue;
    results.push({
      entryId: id,
      entryName: entrySym[0],
      entryKind: entrySym[1],
      entryFile: files[entrySym[4]]?.[0] || '?',
      path,
      length: path.length,
    });
    if (results.length >= maxPaths) break;
  }

  // Shortest first — direct chains are the most informative.
  results.sort((a, b) => a.length - b.length);
  return results;
}

// Per-package aggregate for the package-summary view. Returns one entry per
// package with: file count, symbol count, language breakdown (top-3 by LOC),
// top-3 hubs in this package (by transitive reach), and average complexity
// across non-test symbols.
export function packageSummaries(packages, files, symbols, symInAdj, fileSymbolIds) {
  const perPkgFiles = new Map();
  for (let i = 0; i < files.length; i++) {
    const pkgIdx = files[i][1];
    if (!perPkgFiles.has(pkgIdx)) perPkgFiles.set(pkgIdx, []);
    perPkgFiles.get(pkgIdx).push(i);
  }
  const symStats = new Map(); // pkgIdx -> {count, langs: Map, sumComplex, nComplex}
  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    const fi = sym[4];
    const f = files[fi];
    const pkgIdx = f[1];
    if (!symStats.has(pkgIdx)) symStats.set(pkgIdx, { count: 0, sumComplex: 0, nComplex: 0 });
    const s = symStats.get(pkgIdx);
    s.count++;
    const c = complexity(sym[5]);
    s.sumComplex += c;
    s.nComplex++;
  }
  const out = [];
  for (let i = 0; i < packages.length; i++) {
    const fileIdxs = perPkgFiles.get(i) || [];
    const stats = symStats.get(i) || { count: 0, sumComplex: 0, nComplex: 0 };
    // Language breakdown by LOC
    const langs = new Map();
    for (const fi of fileIdxs) {
      const lang = files[fi][2];
      langs.set(lang, (langs.get(lang) || 0) + (files[fi][3] || 0));
    }
    // Top hubs: symbols in this package with highest transitive reach
    const candidates = [];
    for (let s = 0; s < symbols.length; s++) {
      if (files[symbols[s][4]][1] !== i) continue;
      const inDeg = (symInAdj.get(s) || []).length;
      if (inDeg === 0) continue;
      candidates.push(s);
    }
    candidates.sort((a, b) => transitiveReach(b, symInAdj) - transitiveReach(a, symInAdj));
    out.push({
      pkgIdx: i,
      name: packages[i][0],
      fileCount: fileIdxs.length,
      symbolCount: stats.count,
      avgComplexity: stats.nComplex > 0 ? stats.sumComplex / stats.nComplex : 0,
      languages: [...langs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
      topHubs: candidates.slice(0, 3).map(s => ({
        symId: s,
        name: symbols[s][0],
        kind: symbols[s][1],
        reach: transitiveReach(s, symInAdj),
      })),
    });
  }
  return out;
}

/** Loads graph data from window.__GRAPH_DATA__, falling back to sample data for local dev without a real export. */
export function loadGraphData() {
  if (typeof window !== 'undefined' && window.__GRAPH_DATA__) {
    return window.__GRAPH_DATA__;
  }
  // Sample data so `npm run dev` has something to render without a real export.
  return {
    projectRoot: '',
    packages: [['sample/app', 3, 12], ['sample/lib', 2, 6]],
    packageEdges: [[0, 1, 4, 9]],
    files: [
      ['sample/app/index.ts', 0, 'typescript', 8],
      ['sample/app/utils.ts', 0, 'typescript', 6],
      ['sample/app/widget.tsx', 0, 'tsx', 10],
      ['sample/lib/core.ts', 1, 'typescript', 5],
      ['sample/lib/types.ts', 1, 'typescript', 3],
    ],
    fileEdges: [
      [0, 1, 0, 2], [0, 2, 0, 1], [2, 3, 1, 3], [1, 4, 0, 1], [3, 4, 0, 1],
    ],
    symbols: [
      ['main', 'function', 1, 1, 0, 'function main() {\n  formatDate();\n}', ''],
      ['formatDate', 'function', 4, 1, 1, 'export function formatDate(d) {\n  return d.toISOString();\n}', 'Formats a date as an ISO string.'],
      ['CONFIG', 'constant', 12, 0, 1, 'const CONFIG = { retries: 3 };', ''],
      ['Widget', 'component', 1, 1, 2, 'export function Widget() {\n  return <CoreService.run />;\n}', ''],
      ['CoreService', 'class', 1, 1, 3, 'export class CoreService {\n  run() { /* ... */ }\n}', 'Runs the core background job.'],
      ['run', 'method', 8, 1, 3, 'run() {\n  return this.io.read();\n}', ''],
      ['IUser', 'interface', 1, 1, 4, 'export interface IUser {\n  id: string;\n}', ''],
    ],
    fileSymbolIds: [[0], [1, 2], [3], [4, 5], [6]],
    symbolEdges: [[0, 1, 2], [3, 5, 1]],
    generatedAt: new Date().toISOString(),
  };
}
