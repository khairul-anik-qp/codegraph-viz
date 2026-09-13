import * as path from 'node:path';
import * as vscode from 'vscode';
import { sqliteJson } from './sqlite';

// lib/graph.mjs is plain ESM, shared with the CLI (bin/codegraph-viz.js).
// The extension host loads this file as CommonJS, so it's pulled in via a
// dynamic import rather than a static one. The specifier is read from a
// variable (not a string literal) so tsc treats the import as untyped
// instead of trying to resolve/typecheck the plain-JS module itself.
interface GraphLib {
  findCodegraphDir(startDir: string): string | null;
  extractGraph(
    projectRoot: string,
    db: string,
    sqliteJson: (db: string, sql: string) => Record<string, unknown>[]
  ): Record<string, unknown>;
  buildHtml(data: Record<string, unknown>): string;
}
const GRAPH_LIB_PATH = '../../lib/graph.mjs';
let graphLib: GraphLib | undefined;
/** Lazily loads and caches the shared graph-extraction/HTML-building library from the CLI package. */
async function getGraphLib(): Promise<GraphLib> {
  if (!graphLib) graphLib = await import(GRAPH_LIB_PATH);
  return graphLib as GraphLib;
}

/** Registers the extension's commands with VS Code on activation. */
export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('codegraph.openViewer', openViewer)
  );
}

/** Builds the call-graph HTML for the current workspace and displays it in a webview panel. */
async function openViewer() {
  // v1: first workspace folder only. Multi-root workspaces are a known
  // limitation, not handled here (YAGNI until it's actually needed).
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showErrorMessage('CodeGraph: open a folder or workspace first.');
    return;
  }

  const { findCodegraphDir, extractGraph, buildHtml } = await getGraphLib();

  const projectRoot = folder.uri.fsPath;
  const codegraphDir = findCodegraphDir(projectRoot);
  if (!codegraphDir) {
    vscode.window.showErrorMessage(
      `CodeGraph: no .codegraph/codegraph.db found in or above "${projectRoot}". Run \`codegraph index\` first.`
    );
    return;
  }
  const db = path.join(codegraphDir, 'codegraph.db');

  let html: string;
  try {
    const data = extractGraph(projectRoot, db, sqliteJson);
    html = buildHtml(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`CodeGraph: failed to load graph — ${message}`);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'codegraphViewer',
    'CodeGraph Viewer',
    vscode.ViewColumn.Active,
    { enableScripts: true }
  );
  panel.webview.html = html;
}

/** No-op lifecycle hook required by VS Code's extension API. */
export function deactivate() {}
