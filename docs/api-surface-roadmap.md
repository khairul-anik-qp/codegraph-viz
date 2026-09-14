# API surface — research findings and roadmap

Status: research complete (Sep 2026). P0 items are the agreed next build;
P1/P2 are parked for later. This file is the source of truth for continuing
that work — it records what data is available, what each improvement needs,
and what we deliberately chose not to do.

The API surface view lives in `app/src/lib/RoutesView.svelte`. As of this
writing a route row expands inline to show: handler summary (signature,
doc, call chain), referenced DTO/interface types ("Types involved"), and
frontend call sites matched by scanning symbol snippets for the route path
(params normalize to `*`, so `/api/users/:id` ≡ `/api/users/${id}` ≡
`/api/users/42`). GraphQL QUERY/MUTATION resolvers match by field name
instead of path.

## Data inventory (already exported, unused or underused)

| Field | Where | Feeds |
| --- | --- | --- |
| Handler full snippet | `DATA.symbols[symId][5]` | status codes, `res.json({...})` literal keys, `z.object` schemas, thrown error classes, `req.body` destructuring |
| Decorators | `DATA.symbols[symId][14]` (JSON array) | `@UseGuards` → auth badge, `@HttpCode` → status, NestJS verbs |
| Return type | `DATA.symbols[symId][8]` | response DTO name |
| Signature | `DATA.symbols[symId][7]` | request params (e.g. `create(dto: CreateUserDto)`) |
| `references` usage edges | `symUsageOutAdj` | high-confidence body schemas: handler/callee references a constant whose snippet contains `z.object(` |
| `--diff` overlay | `changedSymIds` / `diffOverlayOn` stores | per-endpoint API changelog (handler changed since ref) |
| `unresolved_refs` (DB only, not exported) | `reference_kind='calls'`, `status='failed'`, `reference_name` | precise http-client call-site detection (`fetch`, `axios`, `router.get`) — would need a new query in `lib/graph.mjs` |

## Prioritized improvements

### P0 — agreed next build

1. **Status/error matrix per endpoint.** Scan the handler snippet for
   `res.status(N)`, `NextResponse.json(..., { status })`, `@HttpCode(N)`,
   `throw new <ErrorClass>` and render status chips with error class names.
   Docs-tooling research is unanimous that error coverage is the single
   highest-value addition; it is fully static and zero-risk.
2. **Auth visibility.** `@UseGuards`/`@Public`/`@Roles` decorators, or
   snippet patterns (`req.user`, `requireAuth`, `Bearer`), render a lock
   badge on the route row. "Auth buried under navigation" is the top
   complaint in API-docs UX surveys.
3. **Copyable curl/fetch skeleton.** Method + path + path params (from the
   route pattern) + inferred body fields (from P1-5 when available) → a
   copy button producing a runnable skeleton. "Show, then tell" — runnable
   examples lead every best-practice guide.
4. **Orphan-endpoint analysis.** Routes with zero frontend call sites
   (already computed for the "Frontend usage" column) become a sortable
   column and a filter chip: dead API surface. No docs tool does this —
   it is the viewer's unique advantage, in the same spirit as the
   dead-code view.

### P1 — built (Sep 2026)

5. **Field-level schema tables.** DONE — "Schemas" column in the expanded
   row: zod schema constants (referenced via usage edges, `z.object(`
   detected in snippet) parse into field/type/optional rows and sort first
   with a green `zod` provenance chip; interface/type-alias shapes parse
   the same way with a `type` chip. `const { a, b } = req.body`
   destructuring shows as a fallback. Raw source collapsible per schema.
   The curl skeleton's `-d` body now uses these parsed fields (zod first,
   then DTO-named types, then destructured names).
6. **API changelog.** DONE — when the export ran with `--diff <ref>`, a
   `∆ N` filter chip appears (changed handlers only), amber `∆` markers on
   affected rows, and `changedRef` is now exported so tooltips say
   "changed since <ref>". No diff data → chip hidden entirely.
7. **Group-by-resource toggle.** DONE — controller/resource segmented
   toggle; resource key = static path prefix (`/api/users/:id` and
   `/api/users` both group under `/api/users`), GraphQL under verb.
8. **Provenance labels.** DONE — `zod`/`type` chips per schema, `inferred`
   label on frontend usage, error-class names inline on mapped status
   chips.

### P2 — built (Sep 2026)

9. **Version segmentation.** DONE — version-prefix chips (`v1`, `v2`…)
   filter routes by the first version-looking path segment; a purple
   version badge also appears in the expanded detail head.
10. **Search typeahead.** DONE — the filter box now shows a suggestion
    dropdown (top 8 matches over method + path + controller name) with
    ↑/↓ navigation, Enter to pick, Escape to dismiss. Picking fills the
    filter with "METHOD /path".
11. **OpenAPI JSON export.** DONE — "⇩ openapi" button serializes the
    whole inferred surface to an OpenAPI 3.1 document: paths with
    `{param}` conversion, per-status responses, requestBody `$ref`s into
    `components.schemas` built from parsed zod/DTO fields, `security`
    on guarded routes, and `x-handler` / `x-frontend-call-sites` /
    `x-inferred` / `x-provenance` extensions throughout. GraphQL/WS
    routes are skipped.

## Non-goal: try-it console

Explicitly rejected. The viewer is a static single-file HTML with no
server, no credentials, and CORS-blocked browser requests. Every
docs-UX guide flags try-it consoles as the highest-risk feature
(credential exposure, accidental production mutation); with no backend
there is no safe way to do it. Do not revisit without a serving mode
that proxies requests.

## Implementation notes

- All P0 work is scan/regex over `DATA.symbols[...][5]` snippets — no
  exporter changes, no DB queries. `lib/graph.mjs` only needs touching
  for P2-11 (unresolved call refs) or richer metadata.
- Status/error scan and auth detection should live as pure helpers in
  `RoutesView.svelte` (or `graph.js` if they earn reuse), built lazily
  per expanded route and cached, mirroring the existing `detailCache`.
- Curl skeleton generation needs a clipboard helper; check whether
  `PathInspector.svelte`'s `copyPathString` can be shared.
- When P1-5 lands, wire its parsed fields into P0-3's body example so
  the curl skeleton shows real field names.
