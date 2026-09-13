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
import { fileURLToPath } from 'node:url';
import { findCodegraphDir, extractGraph, buildHtml } from '../lib/graph.mjs';

const TOOL_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEMPLATE = path.join(TOOL_DIR, 'app', 'dist', 'index.html');
const PKG_PATH = path.join(TOOL_DIR, 'package.json');

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
  --diff <ref>    Mark files changed since <ref> (e.g. main, HEAD~5) for the
                  diff-impact overlay
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
  const opts = { db: null, out: null, cwd: process.cwd(), json: null, port: null, diff: null, quiet: false, version: false, help: false };
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

/** Verifies the `sqlite3` CLI is on PATH, exiting with install instructions if it's missing. */
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

/** Runs a query against the CodeGraph database via the `sqlite3` CLI and parses its JSON output. */
function sqliteJson(db, sql) {
  const out = execFileSync('sqlite3', ['-json', db, sql], { maxBuffer: 1024 * 1024 * 512 });
  const text = out.toString('utf8').trim();
  return text ? JSON.parse(text) : [];
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

const log = (...a) => { if (!opts.quiet) console.error(...a); };
const data = extractGraph(projectRoot, db, sqliteJson, log, opts.diff || null);

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
