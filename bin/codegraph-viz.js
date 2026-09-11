#!/usr/bin/env node
// codegraph-viz — generate an interactive HTML viewer for a CodeGraph-indexed
// codebase. Walks up from cwd to find the nearest .codegraph/ directory,
// queries its SQLite DB, and inlines the result into the pre-built Svelte
// singlefile template bundled with this package.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEMPLATE = path.join(TOOL_DIR, 'app', 'dist', 'index.html');
const PKG_PATH = path.join(TOOL_DIR, 'package.json');
// fflate's package.json doesn't export a "./umd" subpath, so we can't
// `import`/`require` it directly — resolve the package root via its
// (exported) package.json and read the prebuilt UMD bundle off disk instead.
// That bundle defines a `fflate` global when loaded as a plain script, which
// is exactly what the generated HTML needs (no module system available in
// the classic <script> that has to run before the deferred Svelte bundle).
const FFLATE_UMD = path.join(path.dirname(createRequire(import.meta.url).resolve('fflate/package.json')), 'umd', 'index.js');

let PKG = { name: 'codegraph-viz', version: '0.0.0' };
try { PKG = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8')); } catch { /* dev checkout without package.json */ }

if (!fs.existsSync(TEMPLATE)) {
  console.error(`Built viewer not found at ${TEMPLATE}.`);
  console.error(`Run from the package root: npm --prefix app run build`);
  process.exit(1);
}

const HELP = `codegraph-viz ${PKG.version}

Generate an interactive HTML viewer for a CodeGraph-indexed codebase.

Usage:
  codegraph-viz [options]
  codegraph-viz serve [options]

Options:
  --db <path>     Path to codegraph.db (default: <project>/.codegraph/codegraph.db)
  --out <path>    Output HTML file (default: a per-project path under the OS
                  temp dir — nothing is written inside the project, so there's
                  no .gitignore or accidental-commit risk)
  --cwd <path>    Project root to search for .codegraph/ (default: cwd)
  --json <path>   Dump the extracted graph data as JSON, skip HTML generation
  --port <n>      serve only: port to listen on (default: 3000)
  --quiet, -q     Suppress progress output (only the final output path on stdout)
  --version, -V   Print version and exit
  --help, -h      Show this help

\`serve\` regenerates the graph and serves it over HTTP instead of writing a
file, so the viewer opens at a real http:// URL (not file://):

  codegraph-viz serve --port 3000
  # → http://localhost:3000

Requires the \`sqlite3\` CLI on PATH. Install:
  macOS:           brew install sqlite3
  Ubuntu/Debian:   apt-get install sqlite3
  Windows:         choco install sqlite
`;

// Hand-rolled flag parser — zero deps, intentionally minimal. Accepts both
// `--flag value` and `--flag=value` forms. Positional args are rejected.
function parseArgs(argv) {
  const opts = { db: null, out: null, cwd: process.cwd(), json: null, port: null, quiet: false, version: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--version' || a === '-V') opts.version = true;
    else if (a === '--quiet' || a === '-q') opts.quiet = true;
    else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = eq !== -1 ? a.slice(2, eq) : a.slice(2);
      if (!Object.prototype.hasOwnProperty.call(opts, key)) {
        console.error(`Unknown flag: --${key}\nRun --help for usage.`);
        process.exit(1);
      }
      const val = eq !== -1 ? a.slice(eq + 1) : (i + 1 < argv.length ? argv[++i] : null);
      if (val === null) { console.error(`Missing value for --${key}`); process.exit(1); }
      opts[key] = val;
    } else {
      console.error(`Unexpected positional arg: ${a}\nRun --help for usage.`);
      process.exit(1);
    }
  }
  return opts;
}

function findCodegraphDir(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(dir, '.codegraph');
    if (fs.existsSync(path.join(candidate, 'codegraph.db'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function ensureSqlite3() {
  try {
    execFileSync('sqlite3', ['--version'], { stdio: 'ignore' });
  } catch {
    console.error('Error: the `sqlite3` CLI is required but was not found on PATH.');
    console.error('Install it for your platform:');
    console.error('  macOS:           brew install sqlite3');
    console.error('  Ubuntu/Debian:   sudo apt-get install sqlite3');
    console.error('  Fedora/RHEL:     sudo dnf install sqlite');
    console.error('  Windows:         choco install sqlite');
    process.exit(1);
  }
}

function sqliteJson(db, sql) {
  const out = execFileSync('sqlite3', ['-json', db, sql], { maxBuffer: 1024 * 1024 * 512 });
  const text = out.toString('utf8').trim();
  return text ? JSON.parse(text) : [];
}

// Groups a file path into a "package" bucket. Recognizes common monorepo
// container directories (backends/frontends/shared/apps/packages/services/libs)
// and groups by <container>/<child>; otherwise falls back to the top-level
// directory, or 'root' for files sitting directly at the project root.
const CONTAINER_DIRS = new Set(['backends', 'frontends', 'shared', 'apps', 'packages', 'services', 'libs', 'modules']);
function classifyPackage(filePath) {
  const parts = filePath.split('/');
  if (parts.length === 1) return 'root';
  if (CONTAINER_DIRS.has(parts[0]) && parts.length > 1) return `${parts[0]}/${parts[1]}`;
  return parts[0];
}

function extractGraph(projectRoot, db) {
  const log = (...a) => { if (!opts.quiet) console.error(...a); };
  log('Project:', projectRoot);
  log('Database:', db);

  log('Exporting files...');
  const filesRaw = sqliteJson(db, `select path as p, language as l, node_count as nc, modified_at as ma, indexed_at as ia from files`)
    .map(f => ({ ...f, pkg: classifyPackage(f.p) }));

  log('Exporting symbols...');
  const symbolsRaw = sqliteJson(db, `
    select id as id, file_path as p, name as n, kind as k, start_line as ln, end_line as eln, is_exported as ex, docstring as doc,
      signature as sig, return_type as rt, visibility as vis, is_async as asy, is_static as stc
    from nodes
    where kind not in ('import','file')
    order by file_path, start_line
  `);

  log('Exporting file-to-file edges...');
  const fileEdgesRaw = sqliteJson(db, `
    select n1.file_path as s, n2.file_path as t, e.kind as k, count(*) as w
    from edges e
    join nodes n1 on n1.id = e.source
    join nodes n2 on n2.id = e.target
    where e.kind in ('imports','calls') and n1.file_path != n2.file_path
    group by 1,2,3
  `);

  log('Exporting symbol-to-symbol call edges...');
  // Per-edge `line` is the call site inside the source symbol's body — kept
  // (not just counted) so the viewer can point at the exact line a caller
  // invokes a callee on, rather than guessing from a name match. A single
  // (source, target) pair can have several call sites (e.g. a helper called
  // twice in one function), so they're collected into a list below.
  const symbolCallEdgesRaw = sqliteJson(db, `
    select e.source as s, e.target as t, e.line as ln
    from edges e
    join nodes n1 on n1.id = e.source
    join nodes n2 on n2.id = e.target
    where e.kind = 'calls' and n1.kind not in ('import','file') and n2.kind not in ('import','file')
  `);

  // Everything that reaches a symbol WITHOUT calling it: type/constant usage
  // (references), class inheritance (extends/implements), and construction
  // (`new X()`, instantiates). The 'calls' edge above is the only kind the
  // rest of the exporter has ever looked at, which means anything only
  // reachable through one of these — an interface, a constant, a base
  // class — reads as having zero callers even when it's used everywhere.
  // Kept as one combined array (kind is a small int code) since none of
  // these need per-edge line data the way calls do.
  log('Exporting symbol usage edges (references/extends/implements/instantiates)...');
  const symbolUsageEdgesRaw = sqliteJson(db, `
    select e.source as s, e.target as t, e.kind as k
    from edges e
    join nodes n1 on n1.id = e.source
    join nodes n2 on n2.id = e.target
    where e.kind in ('references','extends','implements','instantiates')
      and n1.kind not in ('import','file') and n2.kind not in ('import','file')
  `);

  // unresolved_refs is dominated by things that are only "unresolved"
  // because this tool never indexes node_modules — test-framework globals
  // (expect/it/describe), external packages, builtins. None of that is
  // actionable. What IS actionable: an import written as an internal path
  // (relative, or a `@/`-style alias) that still failed to resolve — that's
  // either a genuinely broken import or a path-alias the indexer doesn't
  // understand, either way worth surfacing. Restricting to reference_kind
  // 'imports' + an internal-looking name cuts ~150k noisy rows down to the
  // handful that are actually worth a look.
  log('Exporting unresolved internal imports...');
  const unresolvedImportsRaw = sqliteJson(db, `
    select file_path as fp, reference_name as rn, line as ln
    from unresolved_refs
    where status = 'failed' and reference_kind = 'imports'
      and (reference_name like './%' or reference_name like '../%' or reference_name like '@/%')
    order by file_path, line
  `);

  log(`files=${filesRaw.length} symbols=${symbolsRaw.length} rawEdges=${fileEdgesRaw.length} symbolCallEdges=${symbolCallEdgesRaw.length} symbolUsageEdges=${symbolUsageEdgesRaw.length} unresolvedImports=${unresolvedImportsRaw.length}`);

  const pathToIdx = new Map();
  filesRaw.forEach((f, i) => pathToIdx.set(f.p, i));

  const pkgNames = [...new Set(filesRaw.map(f => f.pkg))].sort();
  const pkgIdx = new Map(pkgNames.map((p, i) => [p, i]));
  // modifiedAt/indexedAt (epoch ms) let the viewer flag a file as stale — its
  // source changed since the index was last built, so its call graph may be
  // wrong until `codegraph index` reruns.
  const filesOut = filesRaw.map(f => [f.p, pkgIdx.get(f.pkg), f.l, f.nc, f.ma, f.ia]);

  // Snippets are read straight off disk (this tool only ever runs locally,
  // against the same checkout the DB was indexed from) and cached per file.
  // Kept generous (not just the first few lines) so the viewer's "walk this
  // path" view can window around a call site anywhere in the body instead
  // of always showing just the top of the function — only pathologically
  // large functions get truncated.
  const MAX_SNIPPET_LINES = 600;
  const fileLinesCache = new Map();
  function readSnippet(filePath, startLine, endLine) {
    if (!fileLinesCache.has(filePath)) {
      try {
        fileLinesCache.set(filePath, fs.readFileSync(path.join(projectRoot, filePath), 'utf8').split('\n'));
      } catch {
        fileLinesCache.set(filePath, null);
      }
    }
    const lines = fileLinesCache.get(filePath);
    if (!lines) return '';
    const from = Math.max(1, startLine);
    const to = Math.min(lines.length, endLine || startLine);
    const slice = lines.slice(from - 1, to);
    const truncated = slice.length > MAX_SNIPPET_LINES;
    const shown = truncated ? slice.slice(0, MAX_SNIPPET_LINES) : slice;
    return truncated ? `${shown.join('\n')}\n… (${slice.length - MAX_SNIPPET_LINES} more lines)` : shown.join('\n');
  }

  // Global symbol id space: one entry per real symbol (functions, classes,
  // components, etc). dbIdToSymId lets us resolve the calls-edge query above
  // (which references CodeGraph's own node ids) into these compact indices.
  const dbIdToSymId = new Map();
  const symbolsOut = [];
  const symByFile = new Map();
  for (const s of symbolsRaw) {
    const fi = pathToIdx.get(s.p);
    if (fi === undefined) continue;
    const symId = symbolsOut.length;
    dbIdToSymId.set(s.id, symId);
    const doc = s.doc ? s.doc.trim().slice(0, 400) : '';
    const sig = s.sig ? s.sig.trim().slice(0, 300) : '';
    symbolsOut.push([
      s.n, s.k, s.ln, s.ex, fi, readSnippet(s.p, s.ln, s.eln), doc,
      sig, s.rt || '', s.vis || '', s.asy ? 1 : 0, s.stc ? 1 : 0,
    ]);
    if (!symByFile.has(fi)) symByFile.set(fi, []);
    symByFile.get(fi).push(symId);
  }
  const fileSymbolIdsOut = filesOut.map((_, i) => symByFile.get(i) || []);

  const symbolCallAgg = new Map(); // `${si}|${ti}` -> { w, lines: Set }
  for (const e of symbolCallEdgesRaw) {
    const si = dbIdToSymId.get(e.s);
    const ti = dbIdToSymId.get(e.t);
    if (si === undefined || ti === undefined) continue;
    const key = `${si}|${ti}`;
    let agg = symbolCallAgg.get(key);
    if (!agg) { agg = { si, ti, w: 0, lines: new Set() }; symbolCallAgg.set(key, agg); }
    agg.w++;
    if (e.ln != null) agg.lines.add(e.ln);
  }
  const symbolEdgesOut = [...symbolCallAgg.values()]
    .map(({ si, ti, w, lines }) => [si, ti, w, [...lines].sort((a, b) => a - b)]);

  const USAGE_KIND_CODE = { references: 0, extends: 1, implements: 2, instantiates: 3 };
  const symbolUsageAgg = new Map(); // `${si}|${ti}|${kind}` -> count
  for (const e of symbolUsageEdgesRaw) {
    const si = dbIdToSymId.get(e.s);
    const ti = dbIdToSymId.get(e.t);
    if (si === undefined || ti === undefined) continue;
    const key = `${si}|${ti}|${e.k}`;
    symbolUsageAgg.set(key, (symbolUsageAgg.get(key) || 0) + 1);
  }
  const symbolUsageEdgesOut = [...symbolUsageAgg.entries()].map(([key, w]) => {
    const [si, ti, k] = key.split('|');
    return [Number(si), Number(ti), USAGE_KIND_CODE[k], w];
  });

  const unresolvedImportsOut = [];
  for (const r of unresolvedImportsRaw) {
    const fi = pathToIdx.get(r.fp);
    if (fi === undefined) continue;
    unresolvedImportsOut.push([fi, r.rn, r.ln]);
  }

  const edgeMap = new Map();
  for (const e of fileEdgesRaw) {
    const si = pathToIdx.get(e.s);
    const ti = pathToIdx.get(e.t);
    if (si === undefined || ti === undefined) continue;
    const key = `${si}|${ti}|${e.k}`;
    edgeMap.set(key, (edgeMap.get(key) || 0) + e.w);
  }
  const kindCode = { imports: 0, calls: 1 };
  const fileEdgesOut = [...edgeMap.entries()].map(([key, w]) => {
    const [si, ti, k] = key.split('|');
    return [Number(si), Number(ti), kindCode[k], w];
  });

  const pkgEdgeMap = new Map();
  for (const [si, ti, k, w] of fileEdgesOut) {
    const ps = filesOut[si][1];
    const pt = filesOut[ti][1];
    if (ps === pt) continue;
    const key = `${ps}|${pt}`;
    if (!pkgEdgeMap.has(key)) pkgEdgeMap.set(key, [0, 0]);
    pkgEdgeMap.get(key)[k] += w;
  }
  const packagesOut = pkgNames.map((name, i) => {
    const fileCount = filesOut.filter(f => f[1] === i).length;
    const symbolCount = filesOut.reduce((acc, f, fi) => f[1] === i ? acc + fileSymbolIdsOut[fi].length : acc, 0);
    return [name, fileCount, symbolCount];
  });
  const packageEdgesOut = [...pkgEdgeMap.entries()].map(([key, [impW, callW]]) => {
    const [ps, pt] = key.split('|').map(Number);
    return [ps, pt, impW, callW];
  });

  return {
    // Absolute path of the indexed project on disk — needed by the viewer
    // to build vscode:// URIs (file paths in `files`/`symbols` are
    // repo-relative). Empty string if the viewer is hosted somewhere that
    // can't reach the user's local filesystem.
    projectRoot,
    packages: packagesOut,
    packageEdges: packageEdgesOut,
    files: filesOut,
    fileEdges: fileEdgesOut,
    symbols: symbolsOut,
    fileSymbolIds: fileSymbolIdsOut,
    symbolEdges: symbolEdgesOut,
    symbolUsageEdges: symbolUsageEdgesOut,
    unresolvedImports: unresolvedImportsOut,
    generatedAt: new Date().toISOString(),
  };
}

function buildHtml(data) {
  const json = JSON.stringify(data);
  // Source snippets dominate the payload (~70% of it for a large codebase)
  // and compress extremely well -- gzip -9 typically shrinks the whole export
  // 5-6x. Ship it as gzip+base64 instead of a raw JS literal: base64 has no
  // "</script" or "$&"-style special characters to escape (the old raw-JSON
  // approach needed both), and decompressing at load time keeps the on-disk
  // HTML a fraction of the size.
  const gz = zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 9 });
  const b64 = gz.toString('base64');
  const fflateSrc = fs.readFileSync(FFLATE_UMD, 'utf8');

  const tpl = fs.readFileSync(TEMPLATE, 'utf8');
  // The compiled Svelte app reads window.__GRAPH_DATA__ at startup -- both
  // scripts below are classic (non-module) scripts, so they run synchronously
  // at parse time, before the deferred type="module" Svelte bundle, however
  // they're positioned in the document. gunzipSync is genuinely synchronous
  // (unlike DecompressionStream, which is promise-based and would race the
  // app's startup code), so no change to the app's load sequence is needed.
  const dataScript =
    `<script id="graph-data-b64" type="application/octet-stream">${b64}</script>\n` +
    `<script>${fflateSrc}</script>\n` +
    `<script>
      (function () {
        var b64 = document.getElementById('graph-data-b64').textContent;
        var bin = atob(b64);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        var json = new TextDecoder().decode(fflate.gunzipSync(bytes));
        window.__GRAPH_DATA__ = JSON.parse(json);
      })();
    </script>\n`;
  // Anchor on the LAST `</head>` -- the bundled JS may contain literal `</head>`
  // strings (HTML-emitter code in markdown/HTML libs), so the first match is
  // often inside a JS string, not the real end-of-head. Replacing the last
  // one keeps the page structure intact.
  const lastHeadClose = tpl.lastIndexOf('</head>');
  return lastHeadClose !== -1
    ? tpl.slice(0, lastHeadClose) + dataScript + tpl.slice(lastHeadClose)
    : dataScript + tpl;
}

// ---------- main ----------
const rawArgs = process.argv.slice(2);
const isServe = rawArgs[0] === 'serve';
const opts = parseArgs(isServe ? rawArgs.slice(1) : rawArgs);

if (opts.help) { console.log(HELP); process.exit(0); }
if (opts.version) { console.log(PKG.version); process.exit(0); }

ensureSqlite3();

const projectRoot = path.resolve(opts.cwd);
let codegraphDir, db;

if (opts.db) {
  db = path.resolve(opts.db);
  if (!fs.existsSync(db)) {
    console.error(`Error: --db ${db} not found.`);
    process.exit(1);
  }
  codegraphDir = path.dirname(db);
} else {
  codegraphDir = findCodegraphDir(opts.cwd);
  if (!codegraphDir) {
    console.error(`Error: no .codegraph/codegraph.db found in or above "${projectRoot}".`);
    console.error('Either run from inside an indexed project or pass --db <path>.');
    process.exit(1);
  }
  db = path.join(codegraphDir, 'codegraph.db');
}

// Default output lives outside the project entirely (OS temp dir), so
// running this never risks an accidental commit or needs a .gitignore entry.
// Slug includes a short hash of the full path so two differently-located
// projects that happen to share a directory name (e.g. two "backend"
// checkouts) don't collide and overwrite each other's viewer.
const projectSlug = `${path.basename(projectRoot)}-${crypto.createHash('sha1').update(projectRoot).digest('hex').slice(0, 8)}`;
const out = opts.out
  ? path.resolve(opts.out)
  : path.join(os.tmpdir(), 'codegraph-viz', projectSlug, 'index.html');
const outDir = path.dirname(out);

const data = extractGraph(projectRoot, db);

if (opts.json) {
  const jsonPath = path.resolve(opts.json);
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(data));
  if (!opts.quiet) console.error(`Wrote ${jsonPath}`);
  console.log(jsonPath);
  process.exit(0);
}

const html = buildHtml(data);

if (isServe) {
  const port = opts.port ? Number(opts.port) : 3000;
  if (!Number.isInteger(port) || port <= 0) {
    console.error(`Error: --port must be a positive integer, got "${opts.port}"`);
    process.exit(1);
  }
  const body = Buffer.from(html, 'utf8');
  const server = http.createServer((req, res) => {
    // Single-page viewer — every path (and the #view= hash, which never
    // reaches the server) resolves to the same document.
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length });
    res.end(body);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') console.error(`Error: port ${port} is already in use. Pass --port <n> to pick another.`);
    else console.error(`Error: ${err.message}`);
    process.exit(1);
  });
  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    if (!opts.quiet) console.error(`Serving codegraph-viz at ${url}`);
    console.log(url);
  });
} else {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(out, html);
  if (!opts.quiet) console.error(`Wrote ${out}`);
  // Stdout carries only the output path for easy scripting: $(npx codegraph-viz) → open in browser.
  console.log(out);
}
