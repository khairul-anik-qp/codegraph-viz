// Smoke test for lib/graph.mjs — plain Node, no VS Code, no real DB. Feeds a
// fake sqliteJson(db, sql) keyed by which table the query selects from, so
// extractGraph/buildHtml run their real aggregation logic end to end.
import assert from 'node:assert/strict';
import { extractGraph, buildHtml, classifyPackage, findCodegraphDir } from '../lib/graph.mjs';

const FAKE_ROWS = {
  files: [{ p: 'src/a.js', l: 'javascript', nc: 2, ma: 1000, ia: 2000 }, { p: 'src/b.js', l: 'javascript', nc: 1, ma: 1000, ia: 2000 }],
  nodes: [
    { id: 1, p: 'src/a.js', n: 'foo', k: 'function', ln: 1, eln: 1, ex: 1, doc: '', sig: '', rt: '', vis: '', asy: 0, stc: 0 },
    { id: 2, p: 'src/b.js', n: 'bar', k: 'function', ln: 1, eln: 1, ex: 1, doc: '', sig: '', rt: '', vis: '', asy: 0, stc: 0 },
  ],
  edges_file: [{ s: 'src/a.js', t: 'src/b.js', k: 'imports', w: 1 }],
  edges_call: [{ s: 1, t: 2, ln: 1 }],
  edges_usage: [],
  unresolved_refs: [],
  project_metadata: [{ k: 'project_name', v: 'fake-project' }],
};

function fakeSqliteJson(db, sql) {
  if (sql.includes('project_metadata')) return FAKE_ROWS.project_metadata;
  if (sql.includes('from files')) return FAKE_ROWS.files;
  if (sql.includes('from nodes')) return FAKE_ROWS.nodes;
  if (sql.includes('unresolved_refs')) return FAKE_ROWS.unresolved_refs;
  if (sql.includes('e.kind = \'calls\'')) return FAKE_ROWS.edges_call;
  if (sql.includes('references') && sql.includes('extends')) return FAKE_ROWS.edges_usage;
  if (sql.includes('imports') && sql.includes('calls')) return FAKE_ROWS.edges_file;
  throw new Error(`unexpected query: ${sql}`);
}

assert.equal(classifyPackage('root.js'), 'root');
assert.equal(classifyPackage('services/api/index.js'), 'services/api');
assert.equal(classifyPackage('lib/graph.mjs'), 'lib');

assert.equal(findCodegraphDir('/nonexistent/path/that/does/not/exist'), null);

const data = extractGraph('/fake/project', '/fake/project/.codegraph/codegraph.db', fakeSqliteJson);
assert.equal(data.files.length, 2);
assert.equal(data.symbols.length, 2);
assert.equal(data.fileEdges.length, 1);
assert.equal(data.symbolEdges.length, 1);
assert.deepEqual(data.symbolEdges[0], [0, 1, 1, [1]]);
assert.equal(data.packages.length, 1); // both files under 'src'

// changedFileIdxs defaults to [] when no gitDiffRef is passed — must not
// break existing callers that don't know about the diff feature.
assert.deepEqual(data.changedFileIdxs, []);

// Project metadata (k/v rows) is reshaped into a plain object for the viewer.
assert.equal(data.projectMetadata.project_name, 'fake-project');

const html = buildHtml(data);
assert.match(html, /<script id="graph-data-b64"/);
assert.match(html, /__GRAPH_DATA__/);

console.log('ok');
