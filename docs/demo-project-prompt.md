# Demo project generator — prompt

Purpose: CodeGraph Explorer has ~13 views and a lot of per-feature nuance
(schema provenance, entry-point markers, domain tags, diff overlay, orphan
endpoints...), but no single project in the wild exercises all of it at
once — every real demo so far has had to skip features or hand-wave over
gaps. This doc is a self-contained prompt for an AI coding agent (Claude
Code, Cursor, etc.) that scaffolds a small, purpose-built monorepo where
every view has something real to show. Point the agent at an empty
directory and paste the prompt below.

Design intent: TypeScript/JavaScript only, on purpose. That's where every
feature is fully implemented (NestJS decorators, zod, TS types, Svelte
lifecycle hooks); mixing in Python/Java would demo the tool's current gaps
(see "will this work for Python/Java" — signature parsing, decorator
extraction, and return-type inference are TS/JS-shaped) rather than its
strengths. Keep the generated repo small — a few hundred symbols, not
thousands — so a demo can walk it live without waiting on load times or
getting lost in noise.

## The prompt

````
You are scaffolding a small demo monorepo whose only purpose is to exercise
every feature of "CodeGraph Explorer" (a code-graph visualization tool) when
the repo is indexed and opened in it. Optimize for *coverage* of specific,
inspectable patterns over realism or completeness of business logic — every
file should exist because some tool feature needs it, and every choice below
should be visible as one specific thing in the tool, not just plausible code.

Build it as a git repo, commit incrementally (see step 8), and keep the
whole thing under ~300 exported symbols — small enough to walk live in a
demo, not a realistic production app.

## 1. Layout (package/module boundaries matter — see step 2)

demo-codegraph-showcase/
  backends/
    api/          — NestJS REST + GraphQL + WebSocket service (majority of the demo surface)
    worker/       — a separate Node service, deliberately NOT using NestJS
  frontends/
    web/          — a Svelte (or React) SPA that calls SOME but not all of api's routes
  shared/
    lib/          — plain TS utilities imported by api, worker, and web

Use exactly these top-level directory names (`backends/`, `frontends/`,
`shared/`) — the tool groups "packages" by container-dir + child-dir, and
these specific names are what it recognizes. Each of the four leaf folders
(api, worker, web, lib) becomes its own colored bubble in the Packages view,
and cross-folder imports/calls become the edges between them — so make sure
api and worker both import from shared/lib, and web calls into api's routes
by path string (fetch/axios calls with literal URL strings, not through a
generated client) and imports a couple of shared/lib helpers directly too.

## 2. `backends/api` — the API surface (biggest single feature area)

Use NestJS with `@nestjs/swagger` and `class-validator`. Build ~15-18 REST
endpoints across 3-4 controllers, deliberately varying HOW each one exposes
its request/response shape so every parsing path in RoutesView.svelte gets
exercised at least once:

- Several endpoints with a `@Body() body: SomeDto` where `SomeDto` is a real
  exported class using `@ApiProperty`/`class-validator` decorators (the
  common case).
- At least 2 endpoints with an INLINE object-literal body type instead of a
  named DTO: `@Body() body: { foo: string; bar?: number }`.
- At least 2 endpoints whose success response is documented via
  `@ApiResponse({ status: 200, type: SomeResponseDto })` (or
  `@ApiOkResponse`/`@ApiCreatedResponse`) — including at least one where the
  method itself has NO TypeScript return-type annotation, so the swagger
  decorator is the ONLY source of the response shape.
- At least 2 endpoints whose response type comes from the method's own
  return-type annotation instead (`Promise<SomeDto>`, and separately
  `Promise<IApiResponse<SomeDto>>` — a generic wrapper type, to exercise
  one-level generic unwrapping).
- At least 1 endpoint that does `return res.json({ id, name, createdAt })`
  (or NestJS equivalent) with no DTO at all — response inferred from the
  object-literal keys.
- Mix `@HttpCode(200)` (bare numeric) and `@HttpCode(HttpStatus.CREATED)`
  (symbolic) across different handlers. In at least 2 handlers, `throw new
  NotFoundException(...)`/`BadRequestException(...)`/`ForbiddenException(...)`
  so the status/error matrix has real mapped codes, and throw one exotic
  custom error class that ISN'T a recognized NestJS exception, so it shows
  up as a bare "throw" entry instead of a mapped status.
- Auth: put `@UseGuards(SomeGuard)` on one whole controller class (so every
  method in it inherits the guard), then add a single `@Public()` on ONE
  method in that same controller (to prove method-level public overrides
  class-level guard). Leave a second controller with no guards at all
  (public by default, `via: "handler code"` or unknown).
- Leave ~5 of the ~15-18 routes never called from `frontends/web` — these
  become the orphan-endpoint demo. Call the rest from web using plain
  string-literal paths (`fetch('/api/widgets/' + id)`), including at least
  one with a path param and one with a query string.
- Add a GraphQL resolver (a `@Resolver()` class with one `@Query()` and one
  `@Mutation()`) — these should show up as QUERY/MUTATION "routes".
- Add a WebSocket gateway (`@WebSocketGateway()` with one `@SubscribeMessage`
  handler) — shows up as a WS route.
- Also add ONE plain Express-style route somewhere in `api` (a raw
  `router.post('/webhook', ...)` handler, not a NestJS controller) that
  validates its body with a `zod` schema (`SomeSchema.parse(req.body)`,
  where `SomeSchema = z.object({...})`) and destructures
  `const { a, b } = req.body` as a fallback path too — this is the
  non-decorator, non-swagger schema-detection path and needs its own
  example separate from the NestJS controllers.

## 3. `backends/worker` — a second package, different shape

A small Node service (no framework decorators) with 2-3 exported functions
that:
- Import and call a `shared/lib` utility (cross-package call edge).
- Include one `exports.handler = async (event) => {...}` (serverless-style
  entry marker) and one plain script invoked via `process.argv` (CLI entry
  marker) — both should register as "entry points" without needing any
  caller.
- Have zero HTTP routes — this package should contribute to Packages/Files
  views but nothing to API surface, to prove that view correctly shows
  "no routes here" for a non-API package.

## 4. `frontends/web` — the caller side

A Svelte (or React) app with a handful of components:
- A top-level component using `onMount(...)` (Svelte) or `useEffect(...)`
  (React) that calls into `backends/api` — this becomes another
  entry-point marker.
- Calls into roughly 2/3 of api's REST routes (see step 2) using literal
  path strings, plus 1-2 calls into `shared/lib` helpers directly.
- One component or module that is exported but never imported anywhere —
  dead code.

## 5. `shared/lib` — hubs, dead code, and class structure

- One utility function (e.g. a logger, a date formatter, or a response
  envelope helper) imported and called from at least 6-8 places across
  `api`, `worker`, and `web` combined — this is the Hubs-view example.
- 2-3 exported functions with zero callers anywhere in the repo — more
  dead-code examples, in a different package than the one in step 4.
- A small class hierarchy: one abstract/base class, two subclasses that
  `extends` it, and one interface that at least one class `implements` —
  plus at least one `new SomeClass(...)` construction site elsewhere in
  the repo that references it. This is the Structure view's material.
- A tiny mutual-recursion cycle: function A calls function B calls function
  A (guarded so it terminates in real use, e.g. with a depth parameter) —
  this is the cycle-detection badge in the All-flows view.

## 6. Docs coverage (deliberately mixed, not all-or-nothing)

Add real JSDoc/TSDoc comments to roughly a third of exported
functions/classes across the repo, leaving the rest undocumented — Docs
view ranks packages by coverage, so it needs real variance, not 0% or 100%
everywhere.

## 7. Domain tags (deliberately partial)

Add `@domain <Name>` (and a few `@flow <Name>`) JSDoc tags, per
`docs/domain-tagging.md`'s format, to roughly HALF of the genuine entry
points across the repo (route handlers, the GraphQL resolver, the WS
handler, the worker's serverless/CLI entries, the frontend's onMount/
useEffect). Reuse 2-3 distinct domain names across unrelated folders (e.g.
tag something in `api` and something unrelated in `worker` both as
"Notifications") so tagged grouping visibly differs from folder-depth
grouping. Leave the other half of entry points untagged, so Domain View's
folder-depth fallback also has real material to show.

## 8. Git history (for the diff overlay)

Commit in at least 3 steps so there's a meaningful earlier ref to diff
against:
1. Initial scaffold (steps 1-5).
2. Docs + domain tags (steps 6-7).
3. A small, deliberate follow-up change — add one new DTO field, tweak one
   handler's status code, add one new route — that touches only 2-3 files.
Record the commit hash after step 2 in the README (step 10) so a demo can
run `codegraph-viz --diff <that-hash>` and see the step-3 change highlighted.

## 9. One deliberate rough edge (for Index Health)

Leave exactly one broken internal import somewhere (e.g. a relative import
path with a typo, or an import from a file that was renamed/deleted) so
Index Health's unresolved-imports panel has a real, non-empty example. Do
not fix it — it's intentional.

## 10. Write `SHOWCASE.md` at the repo root

After building everything, write a `SHOWCASE.md` that maps every CodeGraph
Explorer view to the exact file/route/symbol that demonstrates it, e.g.:

  ## Packages view
  Open the packages graph — 4 bubbles (api, worker, web, lib), cross-package
  edges from api/worker → lib and web → api.

  ## API surface
  - Zod + destructure fallback: `POST /api/webhook` in `backends/api/src/...`
  - Inline body type: `PATCH /api/widgets/:id` in `...`
  - @ApiResponse-only response type: `GET /api/reports/summary` in `...`
  - Class-level guard + method override: `WidgetsController` /
    `getPublicWidget` in `...`
  - Orphan endpoints: filter "orphan" — should show ~5
  - GraphQL: `...`, WebSocket: `...`

  (...one such entry per view: Flow, All-flows/cycles, Dead code, Hubs,
  Entry points, Pkg summary, Structure, Docs coverage, Domains — tagged vs.
  folder-depth, Index Health, diff overlay command.)

Before writing any code, output your file/route/symbol plan (matching the
structure above) as a table for review. Only start scaffolding after that
plan is confirmed.
````

## Using it

1. Paste the prompt above into a fresh session pointed at an empty directory.
2. Review the plan table it produces before letting it write code — check
   it actually covers every bullet (especially the "at least N" counts).
3. Once built: `codegraph index` it, then `codegraph-viz --diff <commit-2-hash>`
   from the repo root, and open `SHOWCASE.md` as the demo script.
