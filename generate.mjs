#!/usr/bin/env node
// Backward-compat shim for callers (e.g. the codegraph daemon's
// `codegraph:view` command) that still expect the generator at this path.
// The real implementation lives in `bin/codegraph-viz.js` — this file just
// re-exports it so existing invocations keep working.
import './bin/codegraph-viz.js';
