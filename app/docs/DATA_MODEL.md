# Data model

Everything the app renders comes from one object, `DATA`
(`app/src/lib/stores.js` does `export const DATA = loadGraphData();`, and
`loadGraphData()` in `graph.js` reads `window.__GRAPH_DATA__`).

**Every array is positional, not a keyed object.** This is deliberate: the
graph can have 4,000+ files and 20,000+ symbols, and `{"name": "...", "kind":
"..."}` per entry would roughly double the JSON size for keys that repeat
tens of thousands of times. Always index by position (`f[0]`, `s[4]`,
etc.), never assume a shape you can `JSON.stringify` and read back
key-by-key. If you add a field, **append it** — don't reorder existing
indices, or every `DATA.foo[i][N]` call site silently breaks.

## Top-level shape

```js
{
  packages:      [name, fileCount, symbolCount][],
  packageEdges:  [srcPkgIdx, tgtPkgIdx, importWeight, callWeight][],
  files:         [path, pkgIdx, language, nodeCount][],
  fileEdges:     [srcFileIdx, tgtFileIdx, kindCode, weight][],  // kindCode: 0=imports, 1=calls
  symbols:       [name, kind, startLine, isExported, fileIdx, snippet, doc][],
  fileSymbolIds: number[][],   // per fileIdx: global symbol ids belonging to that file
  symbolEdges:   [srcSymId, tgtSymId, weight][],  // calls only, symbol-level
  generatedAt:   ISO date string,
}
```

### `packages[i]` — one entry per detected "package" bucket

| index | field | notes |
|---|---|---|
| 0 | `name` | e.g. `"frontends/journey-management-app"`, or a bare top-level dir name, or `"root"` |
| 1 | `fileCount` | |
| 2 | `symbolCount` | |

Package **index** (`pkgIdx`) is what every other array references, not the
name. Built in `generate.mjs`'s `classifyPackage()` — recognizes a
hardcoded set of monorepo container dirs (`backends`, `frontends`, `shared`,
`apps`, `packages`, `services`, `libs`, `modules`) and groups by
`<container>/<child>`; falls back to the top-level directory name, or
`"root"` for files directly at the project root. This heuristic is generic
on purpose (see DECISIONS.md) — it won't always produce ideal buckets for
every repo shape, but it degrades to "less useful," never "broken."

### `packageEdges[i]` — cross-package aggregate, for the package-overview bubbles

Only includes edges where source and target packages **differ** — built by
rolling up `fileEdges` (below) by package pair. `importWeight`/`callWeight`
are separate running totals, not combined, so the UI can size/color links
by kind.

### `files[i]` — one entry per indexed file

| index | field | notes |
|---|---|---|
| 0 | `path` | project-relative, e.g. `"frontends/.../Foo.tsx"` |
| 1 | `pkgIdx` | index into `packages` |
| 2 | `language` | as CodeGraph reports it (`"typescript"`, `"javascript"`, …) |
| 3 | `nodeCount` | from CodeGraph's own `files.node_count` column — a rough complexity signal, currently unused in the UI but cheap to have |

File **index** (`fileIdx`) is a second, separate index space from
`symId` — don't confuse the two. `fileIdx` is this array's position;
`symId` is `symbols`' position.

### `fileEdges[i]` — file-to-file dependency graph (drives PackageView/FileView)

Resolved from CodeGraph's symbol-level `imports`/`calls` edges by mapping
each edge's source/target node to *its containing file*, then deduping
`(sourceFile, targetFile, kind)` triples and summing occurrence counts into
`weight`. This is why it's called `fileEdges` and not, say,
`fileImportEdges` — it deliberately conflates "file A imports something in
file B" and "a function in file A calls a function in file B" into the
same file-level edge (differentiated only by `kindCode`), because the
package/file views are about *dependency structure*, not call semantics.
For call semantics at the right granularity, see `symbolEdges`.

### `symbols[i]` — one entry per real symbol (function, class, component, etc.)

| index | field | notes |
|---|---|---|
| 0 | `name` | |
| 1 | `kind` | CodeGraph's node kind: `function`, `method`, `class`, `component`, `interface`, `type_alias`, `enum`, `enum_member`, `constant`, `variable`, `property`, `route`, … |
| 2 | `startLine` | 1-indexed |
| 3 | `isExported` | 0/1 |
| 4 | `fileIdx` | index into `files` |
| 5 | `snippet` | source text for `[startLine, endLine]`, read from disk at generate time, capped at 30 lines (longer ones get a `… (N more lines)` suffix). **Empty string** if the source file couldn't be read (renamed/deleted since indexing) or the symbol is otherwise skipped. |
| 6 | `doc` | CodeGraph's captured docstring/JSDoc, trimmed and capped at 400 chars, or `''`. Only ~11% of symbols in this codebase have one — always guard with `if (symbol[6])`, never assume it's present. |

`symbols` **excludes** CodeGraph's `import` and `file` kind nodes (see
`generate.mjs`'s symbol query: `kind not in ('import','file')`) — those
aren't "things a person searches for."

Symbol **id** (`symId`) is this array's position — assigned in file-then-
start_line order during export, so ids are stable across runs as long as
the underlying files/symbols don't change order (they will renumber on
every regenerate; **never persist a symId across a regenerate**, e.g. don't
store one in `localStorage`).

### `fileSymbolIds[fileIdx]` — reverse index, file → its symbols

Just `number[]` of `symId`s. Used everywhere a component needs "what's in
this file" (the file overview's Symbols list, node-radius sizing in
FileView).

### `symbolEdges[i]` — symbol-to-symbol call graph (drives FlowView)

Only `calls` edges where **both** endpoints are real symbols (excludes
edges sourced at a file's top level, e.g. a plain `initializeThing()` call
sitting outside any function — those aren't attributable to a "caller"
symbol). This is a deliberate scope narrowing from CodeGraph's full edge
set: `references`, `instantiates`, `extends`, `implements`, `decorates`
edges are **not** included here. If a future feature needs those (e.g. "who
implements this interface"), it needs its own export + its own adjacency
map — don't repurpose `symbolEdges` for it.

## Derived, in-memory structures (not part of the JSON)

Built once at load in `stores.js` via `buildAdjacency()` (`graph.js`):

- `fileOutAdj` / `fileInAdj` — `Map<fileIdx, [otherFileIdx, kindCode, weight][]>`, from `fileEdges`
- `pkgOutAdj` / `pkgInAdj` — same shape, from `packageEdges`
- `symOutAdj` / `symInAdj` — `Map<symId, [otherSymId, weight][]>`, from `symbolEdges`

`buildAdjacency` is generic over edge tuple length (it does
`edge.slice(2)` for "the rest"), which is why `fileEdges` entries come back
as `[other, kindCode, weight]` triples in the adjacency map but
`symbolEdges` entries come back as `[other, weight]` pairs — same function,
different arity input.
