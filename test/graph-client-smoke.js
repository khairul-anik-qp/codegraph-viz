// Smoke test for the pure client-side graph helpers in app/src/lib/graph.js
// — plain Node, no Svelte/Vite involved, mirrors test/smoke.js's style.
import assert from 'node:assert/strict';
import { buildAdjacency, shortestPath, blastRadius, groupPackagesByDepth, previewChain } from '../app/src/lib/graph.js';

// Graph: 0 -> 1 -> 2 -> 3, and 4 -> 1 (a second caller of 1), 5 is isolated.
const edges = [
  [0, 1, 1], [1, 2, 1], [2, 3, 1], [4, 1, 1],
];
const { out, inn } = buildAdjacency(edges);

// shortestPath: forward chain
assert.deepEqual(shortestPath(0, 3, out, inn), [0, 1, 2, 3]);
// shortestPath: undirected — from a callee back to an unrelated caller of a shared node
assert.deepEqual(shortestPath(3, 4, out, inn), [3, 2, 1, 4]);
// shortestPath: same node
assert.deepEqual(shortestPath(2, 2, out, inn), [2]);
// shortestPath: disconnected
assert.equal(shortestPath(5, 0, out, inn), null);

// blastRadius: from node 3, transitive callers are 2, 1, 0, 4 — plus 3 itself
const radius = blastRadius([3], inn);
assert.deepEqual([...radius].sort((a, b) => a - b), [0, 1, 2, 3, 4]);
// blastRadius: multiple seeds union correctly and don't double-walk
const radius2 = blastRadius([3, 5], inn);
assert.deepEqual([...radius2].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);

// groupPackagesByDepth: truncates package path to `depth` segments and groups indices
const packages = [
  ['app/src/lib', 3, 10],      // 0
  ['app/src/components', 2, 5], // 1
  ['backend/api', 4, 20],       // 2
  ['root', 1, 1],               // 3 (shorter than depth — groups under its own full name)
];
const depth2 = groupPackagesByDepth(packages, 2);
assert.deepEqual([...depth2.keys()].sort(), ['app/src', 'backend/api', 'root']);
assert.deepEqual(depth2.get('app/src').sort((a, b) => a - b), [0, 1]);
assert.deepEqual(depth2.get('backend/api'), [2]);
assert.deepEqual(depth2.get('root'), [3]);

const depth1 = groupPackagesByDepth(packages, 1);
assert.deepEqual([...depth1.keys()].sort(), ['app', 'backend', 'root']);
assert.deepEqual(depth1.get('app').sort((a, b) => a - b), [0, 1]);

// previewChain: linear greedy walk along the first outgoing edge, using the same
// 0 -> 1 -> 2 -> 3, 4 -> 1, 5 isolated fixture graph as above
assert.deepEqual(previewChain(0, out, 4), [0, 1, 2, 3]);
assert.deepEqual(previewChain(0, out, 2), [0, 1, 2]); // hop cap
assert.deepEqual(previewChain(5, out, 4), [5]); // no outgoing edges
assert.deepEqual(previewChain(3, out, 4), [3]); // leaf node

// previewChain: cycle guard stops the walk even though the hop cap alone would too
const { out: cyclicOut } = buildAdjacency([[10, 11, 1], [11, 10, 1]]);
assert.deepEqual(previewChain(10, cyclicOut, 4), [10, 11]);

console.log('graph-client-smoke: OK');
console.log('graph-client-smoke: OK (domain view helpers)');
