# CodeGraph Viz — VS Code extension

Opens the CodeGraph HTML viewer for the current workspace in a webview panel,
via a single command: **CodeGraph: Open Viewer**.

Reuses the same graph-extraction/HTML-build logic as the CLI
(`../lib/graph.mjs`), backed by `better-sqlite3` instead of the `sqlite3` CLI
— no external `sqlite3` binary needed.

See [`../doc/2026-09-11-vscode-extension-design.md`](../doc/2026-09-11-vscode-extension-design.md)
for the design/architecture behind this.

## Build

From the repo root (pnpm workspace):

```
pnpm run build              # Svelte viewer -> app/dist/index.html
pnpm run build:extension    # tsc -> extension/dist/extension.js
```

Or from inside `extension/`:

```
pnpm run build   # one-shot
pnpm run watch   # rebuild on save
```

## Run it (Extension Development Host)

1. Build the viewer and the extension (above) — the extension's HTML
   template comes from `app/dist/index.html`, so `pnpm run build` at the
   root must have been run at least once.
2. Open **this `extension/` directory** as its own VS Code window (not the
   monorepo root — VS Code needs `package.json` at the workspace root to
   find the manifest):
   ```
   code /Users/qp_dev_2_26/Documents/codegraph-viz/extension
   ```
3. Press **F5** ("Run Extension"). This launches a second "Extension
   Development Host" window with the extension loaded.
4. In that new window, open a folder that has `.codegraph/codegraph.db`
   (run `codegraph init` / `codegraph index` there first if it doesn't).
5. Command Palette (`Cmd+Shift+P`) → **"CodeGraph: Open Viewer"**. A webview
   panel should open with the graph.

While iterating on `src/*.ts`: rerun `pnpm run build:extension` (or leave
`pnpm run watch` running), then reload the dev host window (`Cmd+R` in that
window) — no need to relaunch F5 each time.

### Things to check while testing

- No `.codegraph/` in the opened folder → expect `showErrorMessage`, no
  panel created.
- Corrupt/missing `codegraph.db` → same: error surfaced, no crash.
- Panel renders the graph and package/file/symbol views work like the CLI's
  HTML output.
- Multi-root workspaces: v1 only looks at the first workspace folder. Known
  limitation, not handled.

### Known risk: better-sqlite3 native ABI

`better-sqlite3` is a native addon tied to the Node ABI it was built
against. It's built here against your system Node, but the actual
Extension Development Host runs on Electron's bundled Node, which can use a
different ABI. If F5 fails with a native module / ABI mismatch error,
rebuild against Electron's headers:

```
npm rebuild better-sqlite3 --runtime=electron --target=<electron version> --dist-url=https://electronjs.org/headers
```

(or handle this via `@vscode/vsce`'s prepackage step when building a
`.vsix` for real distribution).

## Package as a .vsix (local install, no marketplace)

Not wired up yet (v1 scope is dev-host testing only). When needed:

```
npx @vscode/vsce package
code --install-extension codegraph-viz-vscode-0.1.0.vsix
```

## Out of scope (v1)

- Sidebar/tree view navigation.
- Marketplace publishing (icon, publisher account, CI release flow).
- Multi-root workspace support.
- Any UI beyond the single open-viewer command.
