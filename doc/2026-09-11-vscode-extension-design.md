# VS Code extension for codegraph-viz

## Goal

Surface the existing CodeGraph HTML viewer inside VS Code as a command that
opens a webview panel, instead of requiring the CLI + a browser tab. Reuse the
existing graph-extraction logic rather than reimplementing it.

## Decisions

- **SQLite access:** bundle `better-sqlite3` in the extension. No dependency
  on an external `sqlite3` binary being on PATH — the extension must work
  immediately after install.
- **UI surface:** a single command, `codegraph.openViewer`, that opens the
  viewer in a `vscode.window.createWebviewPanel`. No sidebar/tree view for v1.
- **Repo structure:** monorepo. New `extension/` directory alongside `bin/`
  and `app/`. Graph-extraction logic is pulled out of
  `bin/codegraph-viz.js` into `lib/graph.mjs`, shared by both the CLI and the
  extension.
- **Distribution:** local `.vsix` build + `code --install-extension` for now.
  No marketplace publisher setup, no CI publish flow.

## Architecture

```
lib/graph.mjs              # shared: findCodegraphDir, extractGraph, buildHtml, classifyPackage
bin/codegraph-viz.js        # CLI: imports lib/graph.mjs, supplies sqlite3-CLI-backed query fn
extension/
  package.json               # manifest: contributes.commands, activationEvents, engines.vscode
  src/extension.ts            # activate(), registers codegraph.openViewer
  src/sqlite.ts                # better-sqlite3-backed sqliteJson(db, sql) matching lib/graph.mjs's expected shape
```

`lib/graph.mjs`'s `extractGraph` currently calls a module-level `sqliteJson`
that shells out to the `sqlite3` CLI. This becomes a parameter:
`extractGraph(projectRoot, db, sqliteJson)`. The CLI passes the existing
`execFileSync`-based implementation; the extension passes one backed by
`better-sqlite3`. No other change to `extractGraph`'s logic, output shape, or
the snippet-reading / edge-aggregation behavior.

`buildHtml(data)` is unchanged and reused as-is — it already just takes the
extracted data object and returns a full HTML string (gzip+base64 inlined
graph data, fflate UMD, the prebuilt Svelte `app/dist/index.html` template).

## Data flow

1. User runs `CodeGraph: Open Viewer` (command palette or a bound key).
2. Extension resolves the workspace root (`vscode.workspace.workspaceFolders`)
   and walks up for `.codegraph/codegraph.db` (ported `findCodegraphDir`).
3. Opens the DB with `better-sqlite3`, runs the same queries as the CLI via
   the shared `extractGraph`.
4. `buildHtml` produces the HTML string in memory (no temp file, no HTTP
   server — the CLI's `serve` mode already proves entirely in-memory works).
5. `panel.webview.html = html`.

## Error handling

- No `.codegraph/codegraph.db` found walking up from workspace root: instead
  of the CLI's `console.error` + `process.exit(1)`, `vscode.window.showErrorMessage`
  with the same guidance text ("run `codegraph index`..." / point at docs).
  No panel is created.
- DB open or query failure (corrupt DB, schema mismatch): caught, surfaced via
  `showErrorMessage` with the underlying error message. No panel is created.
- Multi-root workspaces: v1 uses the first workspace folder only. Documented
  as a known limitation, not solved now (YAGNI until it's actually needed).

## Testing

- `lib/graph.mjs` is plain Node with an injected sqlite function — the
  existing `test/smoke.js` pattern extends to call it directly with a fake
  `sqliteJson`, no VS Code or real DB required for the extraction/HTML-build
  logic itself.
- The extension host side (activation, command registration, webview
  creation) is verified manually via the Extension Development Host (`F5` in
  VS Code) — not practical or valuable to unit test webview rendering.
- CLI (`bin/codegraph-viz.js`) behavior must be unchanged after the
  refactor — rerun `npm test` (smoke test) and manually rerun
  `codegraph-viz` / `codegraph-viz serve` against a real `.codegraph/` to
  confirm no regression from extracting `lib/graph.mjs`.

## Out of scope (v1)

- Sidebar/tree view navigation.
- Marketplace publishing (icon, publisher account, CI release flow).
- Multi-root workspace support.
- Any UI beyond the single open-viewer command.
