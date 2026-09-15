# codegraph-viz

Generate an interactive HTML viewer for a [CodeGraph](https://github.com/anomalyco/codegraph)-indexed codebase. Reads the project's `.codegraph/codegraph.db` SQLite file, inlines the extracted graph data into a pre-built Svelte singlefile template, and writes a self-contained `index.html` you can open locally or host on any static server.

## Install

Requires the `sqlite3` CLI on `PATH`. The package itself is a single Node binary with zero runtime dependencies.

```bash
# System deps
brew install sqlite3          # macOS
sudo apt-get install sqlite3  # Ubuntu/Debian

# Package
npm install -g codegraph-viz

# Verify
codegraph-viz --version
```

## Usage

Run from inside an indexed project — the CLI walks up from the current directory to find the nearest `.codegraph/codegraph.db`:

```bash
codegraph-viz
# → writes to a per-project path under the OS temp dir, e.g.
#   /tmp/codegraph-viz/<project>-<hash>/index.html
# open it: open $(codegraph-viz --quiet)
```

Nothing is written inside the project by default — no `.gitignore` entry
needed, no risk of an accidental commit.

Or serve it over HTTP instead of writing a file — useful when `file://` URLs
are blocked or awkward (VS Code's browser panel, sharing a link on the LAN):

```bash
codegraph-viz serve --port 3000
# → http://localhost:3000
```

### Options

| Flag | Description | Default |
| --- | --- | --- |
| `--db <path>` | Path to `codegraph.db` | `<project>/.codegraph/codegraph.db` |
| `--out <path>` | Output HTML file (ignored by `serve`) | `<tmpdir>/codegraph-viz/<project>-<hash>/index.html` |
| `--cwd <path>` | Project root to search for `.codegraph/` | `cwd` |
| `--json <path>` | Dump extracted graph data as JSON, skip HTML | — |
| `--port <n>` | `serve` only: port to listen on | `3000` |
| `--quiet`, `-q` | Suppress progress output | stderr only |
| `--version`, `-V` | Print version | — |
| `--help`, `-h` | Show help | — |

### Examples

```bash
# Default — walks up from cwd, writes outside the project to the OS temp dir
codegraph-viz

# Explicit paths
codegraph-viz --db ./data/codegraph.db --out ./public/codegraph.html

# Dump raw graph data (no HTML wrapping) — useful for custom UIs
codegraph-viz --json graph.json

# CI-friendly: only the final output path on stdout
codegraph-viz --quiet
# stdout: /path/to/.codegraph/viz/index.html
```

## CI: GitHub Actions

The generated HTML is a single self-contained file — generate it in CI and upload it as a workflow artifact.

### Option 1: dedicated action (recommended)

```yaml
- uses: anomalyco/codegraph-viz@v1
  with:
    out: codegraph-viz/index.html
    # diff: main   # optional — highlights files changed since this ref
```

The action runs the CLI from its own checkout (action version == tool version, no `npx` drift), ensures `sqlite3` is available, and uploads `out` as an artifact named `codegraph-viz`. Inputs: `cwd`, `db`, `out`, `diff`, `upload`, `artifact-name`. Requires Node ≥ 18 on the runner (add an `actions/setup-node` step if your job doesn't already have one).

### Option 2: npm package directly

```yaml
- name: Generate viz
  run: npx codegraph-viz --out codegraph-viz/index.html

- name: Upload artifact
  uses: actions/upload-artifact@v4
  with:
    name: codegraph-viz
    path: codegraph-viz/index.html
```

`sqlite3` is preinstalled on GitHub's `ubuntu-latest` and `macos-latest` runners; on Windows runners the dedicated action installs it for you (with `npx`, do it yourself: `choco install sqlite`).

> **Note**: neither the action nor the package *indexes* the codebase. Run your CodeGraph indexing step first (it needs a full tree-sitter parse and is much heavier than viz generation).

## Domain View: grouping by business domain, not folder

Domain View groups packages by folder-depth by default. You can override
this per-symbol by tagging entry-point docstrings with `@domain <Name>`
(and optionally `@flow <Name>`) — no re-index config needed, it reads the
docstring text already exported. See
[docs/domain-tagging.md](docs/domain-tagging.md) for the exact format and a
ready-to-paste LLM prompt that proposes tags across your codebase for you.

## Deploying the output

The generated `index.html` is fully self-contained — no external requests, no build step. Drop it on any static host:

- **GitHub Pages**: commit to a `gh-pages` branch or use `actions/deploy-pages`.
- **Netlify / Vercel / Cloudflare Pages**: serve the file directly.
- **S3 / R2 / GCS**: upload the single file.
- **Local file://**: just double-click it. Works offline.

## How it works

1. The CLI queries `.codegraph/codegraph.db` for files, symbols, and edges via the `sqlite3` CLI's JSON output mode.
2. Snippets are read straight off disk (capped at 30 lines per symbol).
3. The graph is JSON-serialized, escaped against `</script` injection, and injected as `<script>window.__GRAPH_DATA__ = ...</script>` immediately before the bundled app's closing `</head>`.
4. The Svelte SPA at `app/dist/index.html` reads `window.__GRAPH_DATA__` on startup and renders the interactive viewer.

## Development

```bash
# pnpm workspace (app/ and extension/ are members)
pnpm install
pnpm run build        # rebuilds app/dist/index.html (the singlefile template)

# Run the CLI from source
./bin/codegraph-viz.js

# Tests (plain Node, no DB needed)
npm test
```

The package is fully self-contained at runtime: zero npm dependencies
(fflate's UMD bundle is vendored under `lib/vendor/`), only the `sqlite3`
CLI on PATH and Node ≥ 18.

## Releasing

Publishing is wired to tag push via `.github/workflows/publish.yml`. On a `v*` tag the workflow installs with pnpm (frozen lockfile), rebuilds `app/dist/index.html`, runs `npm test` (blocking), publishes to npm with provenance, creates the GitHub Release, and moves the floating major tag (`v0`, `v1`, …) so `uses: anomalyco/codegraph-viz@v1` users stay current.

### One-time setup

1. **npm account** — make sure you're a member of the `anomalyco` org (or change the package name to an unscoped one in `package.json`).
2. **NPM_TOKEN secret** — generate an automation token at <https://www.npmjs.com/settings/~/tokens> (type: **Publish**), then add it as a repository secret: repo **Settings → Secrets and variables → Actions → New repository secret** with name `NPM_TOKEN` and the token value.
3. **(optional) Provenance** — `--provenance` requires the repo to be public AND linked to your npm org. See <https://docs.npmjs.com/generating-provenance-statements>.

### Cutting a release

```bash
# Pick a version
npm version patch   # 0.1.0 → 0.1.1
# or: npm version minor   /  npm version major

# Push the tag — the publish workflow fires automatically
git push --follow-tags

# Watch the run
gh run watch
```

The workflow:

1. Checks out the repo, sets up pnpm 10 + Node 22.
2. `pnpm install --frozen-lockfile` → `pnpm run build` → `npm test` (all blocking).
3. `npm publish --provenance --access public` with `NODE_AUTH_TOKEN=$NPM_TOKEN`.
4. Creates the GitHub Release (auto-generated notes) and force-moves the `v<major>` tag to the new release.

If provenance is enabled, verify the package on npmjs.com — the build sigil should link back to the GitHub Actions run.

### First publish

If `codegraph-viz` is already taken on npm, rename it in `package.json` and update the action example in this README accordingly.

### Dry run before tagging

```bash
pnpm run build
npm pack
tar -tzf codegraph-viz-*.tgz
# Should list: bin/, lib/ (incl. lib/vendor/fflate-umd.js),
# app/dist/index.html, README.md, LICENSE, package.json
```

## License

MIT
