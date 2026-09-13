// Smoke test for the pure client-side graph helpers in app/src/lib/graph.js
// — plain Node, no Svelte/Vite involved, mirrors test/smoke.js's style.
import assert from 'node:assert/strict';
import { buildAdjacency, shortestPath, blastRadius } from '../app/src/lib/graph.js';

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

console.log('graph-client-smoke: OK');
