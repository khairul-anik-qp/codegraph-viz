<script>
  // API surface view: every route/resolver CodeGraph found, grouped by
  // controller and filterable by HTTP method. Clicking a route expands an
  // inline detail panel instead of jumping to the file: handler summary
  // (signature, doc, call chain), status/error matrix, the DTO/interface
  // shapes it touches, and the frontend call sites that hit it. Rows also
  // carry auth badges, frontend-usage counts (0 = orphan endpoint), and a
  // copyable curl/fetch skeleton for each route.
  import { onMount } from 'svelte';
  import { DATA, symOutAdj, symInAdj, symUsageOutAdj, changedSymIds, hasDiffData } from './stores.js';
  import { jumpToSymbol, openAllFlows } from './actions.js';
  import { pkgColor, displayName } from './graph.js';

  const METHOD_COLOR = {
    GET: '#4a90d9', POST: '#3fa77f', PUT: '#c9a13f', PATCH: '#c9a13f',
    DELETE: '#c94f7c', QUERY: '#4a90d9', MUTATION: '#3fa77f', WS: '#a367c9',
  };
  // Usage-edge kind codes (must match graph.js's USAGE_KIND_CODE export).
  const USAGE_REFERENCES = 0;
  const USAGE_INSTANTIATES = 3;
  const TYPE_KINDS = new Set(['interface', 'type_alias', 'class', 'enum']);
  const MAX_TYPES = 6;
  const MAX_CALLEES = 8;
  const MAX_FRONTEND = 6;

  let query = '';
  let methodFilter = null;
  let versionFilter = null;
  let orphansOnly = false;
  let changedOnly = false;
  let groupMode = 'controller'; // 'controller' | 'resource'
  let expanded = new Set();
  // Per-schema "raw source" toggle state, keyed `${symId}-${tid}`.
  let rawOpen = {};
  // Search typeahead state: dropdown visibility + highlighted suggestion.
  let showSuggest = false;
  let focusedSug = -1;
  // Frontend call-site count per route symId, filled once the snippet path
  // index has been built (idle-time). null = not ready yet.
  let feCounts = null;

  // route symbols are named "METHOD /path" by CodeGraph — split once so the
  // method becomes its own filterable/colorable column instead of free text.
  $: routes = (() => {
    const out = [];
    for (let i = 0; i < DATA.symbols.length; i++) {
      const s = DATA.symbols[i];
      if (s[1] !== 'route') continue;
      const sp = s[0].indexOf(' ');
      const method = sp === -1 ? s[0] : s[0].slice(0, sp);
      const path = sp === -1 ? '' : s[0].slice(sp + 1);
      const file = DATA.files[s[4]];
      out.push({
        symId: i, method, path, filePath: file[0], pkgIdx: file[1],
        startLine: s[2], calleeCount: (symOutAdj.get(i) || []).length,
      });
    }
    return out;
  })();

  $: methods = [...new Set(routes.map(r => r.method))].sort();

  $: byController = (() => {
    const q = query.trim().toLowerCase();
    const filtered = routes.filter(r => {
      if (methodFilter && r.method !== methodFilter) return false;
      if (versionFilter && versionOf(r.path) !== versionFilter) return false;
      if (orphansOnly && feCounts && (feCounts.get(r.symId) || 0) > 0) return false;
      if (changedOnly && !changedSymIds.has(r.symId)) return false;
      if (q && !(r.method + ' ' + r.path).toLowerCase().includes(q)) return false;
      return true;
    });
    const groups = new Map();
    for (const r of filtered) {
      const key = groupMode === 'controller' ? r.filePath : resourceKey(r);
      if (!groups.has(key)) groups.set(key, { key, pkgIdx: r.pkgIdx, routes: [] });
      groups.get(key).routes.push(r);
    }
    return [...groups.values()]
      .map(g => ({ ...g, routes: g.routes.sort((a, b) => a.startLine - b.startLine) }))
      .sort((a, b) => b.routes.length - a.routes.length);
  })();

  // Resource grouping key: the static (non-param) prefix of the route path —
  // '/api/users/:id' and '/api/users' both group under '/api/users'.
  // GraphQL resolvers (no slash in path) group under their verb.
  function resourceKey(r) {
    if (!r.path.includes('/')) return `${r.method} fields`;
    const segs = r.path.split('/').filter(Boolean);
    const staticSegs = [];
    for (const s of segs) {
      if (s.startsWith(':') || s.startsWith('{') || s.startsWith('${')) break;
      staticSegs.push(s);
    }
    return '/' + (staticSegs.length ? staticSegs.join('/') : '…');
  }

  $: changedCount = hasDiffData ? routes.filter(r => changedSymIds.has(r.symId)).length : 0;
  $: totalShown = byController.reduce((acc, g) => acc + g.routes.length, 0);

  // ---- P2: version segmentation ----
  // First path segment that looks like a version ('v1', 'v2.0'…), or null.
  function versionOf(path) {
    if (!path.includes('/')) return null;
    for (const seg of path.split('/')) {
      if (/^v\d+(\.\d+)?$/i.test(seg)) return seg.toLowerCase();
    }
    return null;
  }
  $: versions = [...new Set(routes.map(r => versionOf(r.path)).filter(Boolean))].sort();

  // ---- P2: search typeahead ----
  // Top route matches over method + path + controller name. Picking one
  // fills the filter with "METHOD /path", which the substring filter above
  // matches exactly.
  $: suggestions = (() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const r of routes) {
      const hay = `${r.method} ${r.path} ${displayName(r.filePath)}`.toLowerCase();
      if (hay.includes(q)) out.push(r);
      if (out.length >= 8) break;
    }
    return out;
  })();
  function onSearchKey(e) {
    if (!showSuggest || !suggestions.length) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); focusedSug = Math.min(focusedSug + 1, suggestions.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusedSug = Math.max(focusedSug - 1, 0); }
    else if (e.key === 'Enter' && focusedSug >= 0) { e.preventDefault(); pickSuggestion(suggestions[focusedSug]); }
    else if (e.key === 'Escape') { showSuggest = false; e.target.blur(); }
  }
  function pickSuggestion(r) {
    query = `${r.method} ${r.path}`;
    showSuggest = false;
    focusedSug = -1;
  }

  // ---- P2: OpenAPI export ----
  // Maps a parsed field type to a JSON Schema property. Unknown types keep
  // the raw source type as a description instead of guessing.
  function fieldToJsonSchema(f) {
    const t = f.type;
    if (t === 'string') return { type: 'string' };
    if (t === 'number' || t === 'bigint') return { type: 'number' };
    if (t === 'boolean') return { type: 'boolean' };
    if (t === 'Date') return { type: 'string', format: 'date-time' };
    if (/\[\]$/.test(t)) return { type: 'array' };
    if (t === 'object' || t === 'record') return { type: 'object' };
    if (t.includes(' | ')) return { type: 'string', enum: t.split(' | ') };
    return { description: t };
  }
  // Serializes the whole inferred surface (paths, statuses, schemas, auth,
  // frontend usage counts) into an OpenAPI 3.1 document. Everything
  // heuristic carries an x-inferred / x-provenance marker so consumers can
  // tell exact from guessed. GraphQL/WS routes are skipped (not HTTP).
  function buildOpenApi() {
    const spec = {
      openapi: '3.1.0',
      info: {
        title: 'Inferred API surface',
        version: '1.0.0',
        description: 'Statically inferred from source by codegraph-viz. Anything marked x-inferred or x-provenance is heuristic — verify before publishing.',
      },
      tags: [],
      paths: {},
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', description: 'Inferred from handler decorators/code' },
        },
        schemas: {},
      },
    };
    const tagSet = new Set();
    for (const r of routes) {
      if (r.method === 'QUERY' || r.method === 'MUTATION' || r.method === 'WS') continue;
      const openApiPath = r.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      const tag = displayName(r.filePath);
      tagSet.add(tag);
      const st = scanStatuses(r.symId);
      const d = routeDetail(r);
      const au = authInfo(r.symId);
      const responses = {};
      for (const s of st.statuses) responses[String(s.code)] = { description: `via ${s.via}` };
      if (!Object.keys(responses).length) responses['200'] = { description: 'assumed (no explicit status found)' };
      const op = {
        summary: d.doc ? d.doc.slice(0, 120) : `${r.method} ${r.path}`,
        tags: [tag],
        'x-handler': `${r.filePath}:${r.startLine}`,
        'x-frontend-call-sites': findFrontendCallSites(r).length,
        responses,
      };
      if (au && au.level === 'guarded') op.security = [{ bearerAuth: [] }];
      if (r.method === 'POST' || r.method === 'PUT' || r.method === 'PATCH') {
        const zod = d.request.find(sch => sch.source === 'zod' && sch.fields.length);
        const dto = zod || d.request.find(sch => sch.source === 'type' && sch.fields.length);
        if (dto) {
          const props = {};
          const required = [];
          for (const f of dto.fields) {
            props[f.name] = fieldToJsonSchema(f);
            if (f.required) required.push(f.name);
          }
          spec.components.schemas[dto.name] = {
            type: 'object',
            properties: props,
            ...(required.length ? { required } : {}),
            'x-provenance': dto.source,
          };
          op.requestBody = {
            required: true,
            content: { 'application/json': { schema: { $ref: `#/components/schemas/${dto.name}` } } },
            'x-inferred': true,
          };
        }
      }
      if (!spec.paths[openApiPath]) spec.paths[openApiPath] = {};
      spec.paths[openApiPath][r.method.toLowerCase()] = op;
    }
    spec.tags = [...tagSet].sort().map(t => ({ name: t }));
    if (!Object.keys(spec.components.schemas).length) delete spec.components.schemas;
    return spec;
  }
  function exportOpenApi() {
    const blob = new Blob([JSON.stringify(buildOpenApi(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'openapi-codegraph.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Toggles one route's inline detail panel.
  function toggleExpand(symId) {
    if (expanded.has(symId)) expanded.delete(symId);
    else expanded.add(symId);
    expanded = new Set(expanded);
  }

  // A CodeGraph `route` node is a synthetic single-line stub sitting at the
  // decorator line (e.g. `@Get('health')`) — it has no signature, no call
  // edges, and its "snippet" is just that one line. The actual handler
  // (whose signature, body and DTOs everything below wants) is the very
  // next method/function node in the same file. Resolved once per route
  // and cached.
  const handlerIdCache = new Map();
  function findHandlerSymId(routeSymId) {
    if (handlerIdCache.has(routeSymId)) return handlerIdCache.get(routeSymId);
    const fileIdx = DATA.symbols[routeSymId][4];
    let handlerId = null;
    for (let i = routeSymId + 1; i < DATA.symbols.length && i < routeSymId + 20; i++) {
      const sym = DATA.symbols[i];
      if (sym[4] !== fileIdx || sym[1] === 'route') break;
      if (sym[1] === 'method' || sym[1] === 'function') { handlerId = i; break; }
    }
    handlerIdCache.set(routeSymId, handlerId);
    return handlerId;
  }

  // ---- inline detail (built lazily on first expand, then cached) ----
  const detailCache = new Map();
  function routeDetail(r) {
    if (!detailCache.has(r.symId)) detailCache.set(r.symId, buildDetail(r));
    return detailCache.get(r.symId);
  }

  // ---- P1: field-level schema parsing ----
  // Collapses a zod chain to a short type label: z.string().email() →
  // 'string', z.enum(["a","b"]) → 'a" | "b', z.array(z.string()) → 'string[]'.
  function zodTypeLabel(expr) {
    let e = expr.trim().replace(/\s+/g, '');
    let m;
    if ((m = /^z\.(coerce\.)?(string|number|boolean|date|bigint|symbol|any|unknown|never|void)\b/.exec(e))) {
      return m[2];
    }
    if ((m = /^z\.enum\(\[([^\]]*)\]/.exec(e))) return m[1].replace(/["'\s]/g, '').split(',').join(' | ');
    if ((m = /^z\.nativeEnum\(\s*([A-Za-z_$][\w$]*)/.exec(e))) return m[1];
    if ((m = /^z\.array\((.*)$/.exec(e))) return zodTypeLabel(m[1].replace(/\)$/, '')) + '[]';
    if (/^z\.object\(/.test(e)) return 'object';
    if (/^z\.record\(/.test(e)) return 'record';
    if (/^z\.union\(|^z\.discriminatedUnion\(/.test(e)) return 'union';
    if ((m = /^z\.instanceof\(\s*([A-Za-z_$][\w$]*)/.exec(e))) return m[1];
    if (/^z\.lazy\(/.test(e)) return 'ref';
    return 'any';
  }
  // Parses a z.object({...}) constant body into field rows.
  function parseZodFields(snippet) {
    const fields = [];
    for (const line of snippet.split('\n')) {
      const m = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*:\s*(.+?)\s*,?\s*$/.exec(line);
      if (!m || !/^z\./.test(m[2].trim())) continue;
      const expr = m[2].trim();
      fields.push({
        name: m[1],
        type: zodTypeLabel(expr),
        required: !/\.optional\(\)|\.default\(|\.nullable\(\)/.test(expr),
      });
      if (fields.length >= 20) break;
    }
    return fields;
  }
  // Parses a TS interface/type-alias body into field rows.
  function parseTypeFields(snippet) {
    const fields = [];
    for (const line of snippet.split('\n')) {
      const m = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)(\?)?\s*:\s*(.+?)(?:;|,)?\s*$/.exec(line);
      if (!m || /\(/.test(m[3])) continue; // method signatures aren't fields
      fields.push({ name: m[1], type: m[3].trim(), required: m[2] !== '?' });
      if (fields.length >= 20) break;
    }
    return fields;
  }
  // `const { a, b } = req.body` in the handler — field names without types.
  function reqBodyDestructure(snippet) {
    const m = /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*(?:req|request|ctx)\.body/.exec(snippet || '');
    if (!m) return [];
    return m[1].split(',').map(s => s.trim().split(':')[0].trim()).filter(Boolean).slice(0, 20);
  }

  // ---- schema resolution by name ----
  // Usage edges are the precise way to find schemas, but they miss types
  // that only appear in parameter/return positions (decorator params like
  // `@Body() dto: CreateUserDto` emit no references edge). So every shape
  // name seen in signatures, z.parse() calls, and `new X()` expressions is
  // also resolved through this index — first hit wins, ties prefer the
  // first-defined symbol.
  let schemaNameIdx = null;
  function getSchemaNameIdx() {
    if (schemaNameIdx) return schemaNameIdx;
    const idx = new Map();
    for (let i = 0; i < DATA.symbols.length; i++) {
      const s = DATA.symbols[i];
      const isZod = /z\.object\(/.test(s[5] || '');
      const ok = TYPE_KINDS.has(s[1]) || ((s[1] === 'constant' || s[1] === 'variable' || s[1] === 'function' || s[1] === 'method') && isZod);
      if (!ok) continue;
      if (!idx.has(s[0])) idx.set(s[0], []);
      idx.get(s[0]).push(i);
    }
    schemaNameIdx = idx;
    return idx;
  }
  function lookupSchema(name) {
    const hits = getSchemaNameIdx().get(name);
    return hits && hits.length ? hits[0] : null;
  }
  // One schema block for a symbol id: zod constants parse as zod fields,
  // everything else as TS type fields.
  function schemaEntry(tid, via) {
    const t = DATA.symbols[tid];
    const snippet = (t[5] || '').trim();
    const isZod = /z\.object\(/.test(snippet);
    return {
      tid, name: t[0], kind: t[1], snippet, via,
      source: isZod ? 'zod' : 'type',
      fields: isZod ? parseZodFields(snippet) : parseTypeFields(snippet),
    };
  }

  // Finds the index matching the bracket at openIdx (any of `([{`), tracking
  // all three depths together — good enough since real source is balanced.
  function matchBracket(str, openIdx) {
    let depth = 0;
    for (let i = openIdx; i < str.length; i++) {
      const c = str[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }
  // Splits str on any of `sepChars` at top level only — occurrences inside
  // `([{<...>}])` don't count. Used for parameter lists and inline object
  // literal fields, both of which can nest generics/objects/arrays.
  function splitTopLevel(str, sepChars = ',') {
    const parts = [];
    let depth = 0, start = 0;
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (c === '(' || c === '[' || c === '{' || c === '<') depth++;
      else if (c === ')' || c === ']' || c === '}' || c === '>') depth--;
      else if (depth === 0 && sepChars.includes(c)) { parts.push(str.slice(start, i)); start = i + 1; }
    }
    parts.push(str.slice(start));
    return parts;
  }
  // Strips leading parameter decorators (`@Body()`, `@Param('id', Pipe)`,
  // possibly several in a row) so what's left is `name: Type`.
  function stripParamDecorators(part) {
    let s = part.trimStart();
    while (s[0] === '@') {
      const m = /^@[\w$]+/.exec(s);
      if (!m) break;
      let i = m[0].length;
      if (s[i] === '(') {
        const close = matchBracket(s, i);
        i = close === -1 ? s.length : close + 1;
      }
      s = s.slice(i).trimStart();
    }
    return s;
  }
  // Splits a signature's parameter list, correctly, even when a param is
  // preceded by one or more decorators that themselves contain parens
  // (`@Body()`, `@Param('id', ParseIntPipe)`) — naive indexOf(')') stops at
  // the decorator's own closing paren and mangles everything after it.
  function paramParts(sig) {
    if (!sig) return null;
    const open = sig.indexOf('(');
    if (open === -1) return null;
    const close = matchBracket(sig, open);
    if (close === -1) return null;
    return { inner: sig.slice(open + 1, close), afterClose: sig.slice(close + 1) };
  }
  // Type names from a signature's parameter list, primitives excluded —
  // `create(dto: CreateUserDto, user: AuthedUser)` → ['CreateUserDto', 'AuthedUser'].
  const NON_DTO_TYPES = /^(string|number|boolean|any|unknown|never|void|object|symbol|bigint|Array|Promise|Record|Map|Set|Date|Request|Response|NextFunction|Next|Params|Param|Body|Query|Headers|IPartials|String|Number|Boolean)$/i;
  // `type: XDto` (or `type: [XDto]` for an array response) out of a
  // `@ApiBody({...})`/`@ApiResponse({...})`-shaped decorator call — the
  // explicit, documented wire type, when the project uses
  // @nestjs/swagger (or another `type:`-carrying decorator convention).
  // Scans `text` (expected to be just the decorator lines, from
  // leadingDecoratorText) for every call to one of `decoratorNames` and
  // pulls the `type:` property out of its (possibly nested-brace) argument.
  function decoratorTypeNames(text, decoratorNames) {
    const out = [];
    const re = new RegExp(`@(?:${decoratorNames})\\b\\s*`, 'g');
    let m;
    while ((m = re.exec(text))) {
      if (text[re.lastIndex] !== '(') continue;
      const close = matchBracket(text, re.lastIndex);
      if (close === -1) continue;
      const argText = text.slice(re.lastIndex + 1, close);
      const tm = /\btype\s*:\s*\[?\s*([A-Za-z_$][\w$]*)/.exec(argText);
      if (tm && !NON_DTO_TYPES.test(tm[1]) && out.indexOf(tm[1]) === -1) out.push(tm[1]);
      re.lastIndex = close + 1;
    }
    return out;
  }
  function signatureParamTypes(sig) {
    const pp = paramParts(sig);
    if (!pp) return [];
    const out = [];
    for (const rawPart of splitTopLevel(pp.inner)) {
      const part = stripParamDecorators(rawPart.trim());
      const m = /^(?:\.\.\.)?[\w$]+\??\s*:\s*([A-Za-z_$][\w$]*)/.exec(part);
      if (!m || NON_DTO_TYPES.test(m[1])) continue;
      out.push(m[1]);
    }
    return out;
  }
  // A body/data/dto/etc. param typed as an inline object literal instead of
  // a named DTO — `@Body() body: { key: string; value?: number }` — has no
  // symbol to look up, so its fields are parsed straight out of the
  // signature text. Only one is returned (first match wins).
  const INLINE_PARAM_NAME_RE = /create|update|input|body|payload|dto|request|data/i;
  function parseInlineObjectFields(braceText) {
    const inner = braceText.trim().replace(/^\{/, '').replace(/\}$/, '');
    const fields = [];
    for (const raw of splitTopLevel(inner, ';,')) {
      const line = raw.trim();
      if (!line) continue;
      const m = /^(?:readonly\s+)?([A-Za-z_$][\w$]*)(\?)?\s*:\s*([\s\S]+)$/.exec(line);
      if (!m) continue;
      fields.push({ name: m[1], type: m[3].trim().replace(/\s+/g, ' '), required: m[2] !== '?' });
      if (fields.length >= 20) break;
    }
    return fields;
  }
  function signatureInlineBodyType(sig) {
    const pp = paramParts(sig);
    if (!pp) return null;
    for (const rawPart of splitTopLevel(pp.inner)) {
      const part = stripParamDecorators(rawPart.trim());
      const m = /^(?:\.\.\.)?([\w$]+)\??\s*:\s*(\{[\s\S]*\})\s*$/.exec(part.trim());
      if (!m || !INLINE_PARAM_NAME_RE.test(m[1])) continue;
      const fields = parseInlineObjectFields(m[2]);
      if (fields.length) return { name: m[1], text: m[2], fields };
    }
    return null;
  }
  // Return type from the signature text itself — `return_type` on the node
  // is frequently blank for methods relying on inference or decorated
  // params (e.g. every NestJS controller method sampled had it empty),
  // even when the signature spells the type out after the closing paren.
  function signatureReturnType(sig) {
    const pp = paramParts(sig);
    if (!pp) return '';
    const m = /^\s*:\s*(.+)$/s.exec(pp.afterClose.trim());
    return m ? m[1].trim().replace(/[;{]\s*$/, '') : '';
  }
  function stripPromise(t) {
    const m = /^Promise<([\s\S]+)>$/.exec(t || '');
    return m ? m[1].trim() : (t || '').trim();
  }
  // One level of generic unwrap — `IApiResponse<UserDto>` → `UserDto` —
  // covers the common `ApiResponse<T>`/`Wrapper<T>` response envelopes.
  function unwrapGeneric(t) {
    const m = /^[A-Za-z_$][\w$]*<([\s\S]+)>$/.exec((t || '').trim());
    return m ? m[1].trim() : null;
  }
  // Candidate type names to try against the schema index, in order:
  // the type as written, then one level of generic unwrap, then another
  // (covers `Promise<IApiResponse<UserDto>>` after stripPromise already ran).
  function returnTypeCandidates(t) {
    const out = [];
    let cur = (t || '').trim();
    for (let i = 0; i < 3 && cur; i++) {
      if (out.indexOf(cur) === -1) out.push(cur);
      const un = unwrapGeneric(cur);
      if (!un || un === cur) break;
      cur = un;
    }
    return out;
  }
  // `CreateUserSchema.parse(req.body)` → 'CreateUserSchema'.
  function zodParseNames(snippet) {
    const out = [];
    let m;
    const re = /([A-Za-z_$][\w$]*)\.(?:safeParse|parse)\s*\(/g;
    while ((m = re.exec(snippet || ''))) {
      if (out.indexOf(m[1]) === -1) out.push(m[1]);
      if (out.length >= 8) break;
    }
    return out;
  }
  // `new UserDto(...)` → 'UserDto'.
  function newNames(snippet) {
    const out = [];
    let m;
    const re = /new\s+([A-Z]\w*)\s*\(/g;
    while ((m = re.exec(snippet || ''))) {
      if (out.indexOf(m[1]) === -1) out.push(m[1]);
      if (out.length >= 8) break;
    }
    return out;
  }
  // Top-level keys of a `res.json({ a, b })` object literal — the actual
  // response shape when no DTO wraps it.
  function jsonKeys(snippet) {
    const keys = [];
    let m;
    const re = /\.(?:json|send)\(\s*\{([^}]*)\}\s*[,)]/g;
    while ((m = re.exec(snippet || ''))) {
      for (const part of m[1].split(',')) {
        const k = part.split(':')[0].trim().replace(/^(\.\.\.)?/, '');
        if (/^[A-Za-z_$][\w$]*$/.test(k) && keys.indexOf(k) === -1) keys.push(k);
        if (keys.length >= 12) return keys;
      }
    }
    return keys;
  }
  const REQUEST_NAME_RE = /create|update|input|body|payload|dto|request|params|query|args/i;

  function buildDetail(r) {
    const handlerId = findHandlerSymId(r.symId) ?? r.symId;
    const s = DATA.symbols[handlerId];
    const callees = (symOutAdj.get(handlerId) || [])
      .slice().sort((a, b) => b[1] - a[1])
      .slice(0, MAX_CALLEES)
      .map(([id, w]) => ({ id, w }));
    const calleeSnips = callees.map(c => DATA.symbols[c.id][5] || '');
    const calleeSyms = callees.map(c => DATA.symbols[c.id]);

    // Usage-edge schemas (precise provenance) from the handler + callees.
    const edgeEntries = [];
    const edgeSeen = new Set();
    for (const src of [handlerId, ...callees.map(c => c.id)]) {
      for (const [tid, kind] of (symUsageOutAdj.get(src) || [])) {
        if (edgeSeen.has(tid)) continue;
        if (kind !== USAGE_REFERENCES && kind !== USAGE_INSTANTIATES) continue;
        const k = DATA.symbols[tid][1];
        if (TYPE_KINDS.has(k)) { edgeSeen.add(tid); edgeEntries.push(schemaEntry(tid, 'usage edge')); }
        else if ((k === 'constant' || k === 'variable') && /z\.object\(/.test(DATA.symbols[tid][5] || '')) { edgeSeen.add(tid); edgeEntries.push(schemaEntry(tid, 'usage edge')); }
      }
    }

    // Request shapes: zod schemas parsed in the handler (that IS the wire
    // format), then usage-edge zod consts, then DTO types named in the
    // handler's or its callees' signatures.
    const usedTids = new Set();
    const request = [];
    const pushReq = (e) => {
      if (e.tid != null) { if (usedTids.has(e.tid)) return; usedTids.add(e.tid); }
      if (request.length < MAX_TYPES) request.push(e);
    };
    // Explicit, documented wire types beat everything else: @ApiBody({ type:
    // X }) (nestjs/swagger) is authored specifically to describe the
    // request, so it's tried first.
    const ownDecoratorText = leadingDecoratorText(s[5]);
    for (const n of decoratorTypeNames(ownDecoratorText, 'ApiBody')) {
      const tid = lookupSchema(n);
      if (tid != null) pushReq(schemaEntry(tid, '@ApiBody'));
    }
    for (const n of zodParseNames(s[5])) {
      const tid = lookupSchema(n);
      if (tid != null) pushReq(schemaEntry(tid, 'z.parse() in handler'));
    }
    for (const e of edgeEntries) {
      if (e.source === 'zod') pushReq(e);
      else if (REQUEST_NAME_RE.test(e.name)) pushReq(e);
    }
    const paramNames = [...new Set([
      ...signatureParamTypes(s[7]),
      ...calleeSyms.flatMap(cs => signatureParamTypes(cs[7])),
    ])];
    for (const n of paramNames) {
      const tid = lookupSchema(n);
      if (tid != null) pushReq(schemaEntry(tid, 'signature param'));
    }
    // Fallback: a body/dto/etc. param typed as an inline object literal
    // (no named DTO to look up) — parse its fields straight off the
    // signature text.
    if (!request.length) {
      const inline = signatureInlineBodyType(s[7]) || calleeSyms.map(cs => signatureInlineBodyType(cs[7])).find(Boolean);
      if (inline) {
        pushReq({ tid: null, name: inline.name, kind: 'inline', snippet: inline.text, via: 'signature param (inline)', source: 'type', fields: inline.fields });
      }
    }

    // Response shapes: return types (handler + service callees), types
    // constructed with `new X()`, res.json({ ... }) literal keys, then any
    // remaining usage-edge types that don't look request-shaped.
    const response = [];
    const pushRes = (e) => {
      if (e.tid != null) { if (usedTids.has(e.tid)) return; usedTids.add(e.tid); }
      if (response.length < MAX_TYPES) response.push(e);
    };
    // Same for the response: @ApiResponse/@ApiOkResponse/@ApiCreatedResponse/
    // @ApiAcceptedResponse({ type: X }) is the documented success shape.
    for (const n of decoratorTypeNames(ownDecoratorText, 'ApiResponse|ApiOkResponse|ApiCreatedResponse|ApiAcceptedResponse')) {
      const tid = lookupSchema(n);
      if (tid != null) pushRes(schemaEntry(tid, '@ApiResponse'));
    }
    const returnNames = [...new Set([
      ...returnTypeCandidates(stripPromise(s[8] || signatureReturnType(s[7]))),
      ...calleeSyms.flatMap(cs => returnTypeCandidates(stripPromise(cs[8] || signatureReturnType(cs[7])))),
    ].filter(Boolean))];
    for (const n of returnNames) {
      const tid = lookupSchema(n);
      if (tid != null) pushRes(schemaEntry(tid, 'return type'));
    }
    for (const n of newNames(s[5])) {
      const tid = lookupSchema(n);
      if (tid != null) pushRes(schemaEntry(tid, 'new X() in handler'));
    }
    for (const e of edgeEntries) {
      if (!usedTids.has(e.tid)) pushRes(e);
    }
    const rjKeys = jsonKeys(s[5]);
    if (rjKeys.length) response.push({ name: 'res.json keys', source: 'json', keys: rjKeys, tid: null });

    return {
      signature: s[7] || '',
      doc: s[6] ? s[6].split('\n\n')[0].replace(/\s+/g, ' ').trim() : '',
      badges: [s[3] ? 'exported' : '', s[10] ? 'async' : ''].filter(Boolean),
      callees,
      request,
      response,
      paramNames,
      destructure: reqBodyDestructure(s[5]),
      frontend: findFrontendCallSites(r),
    };
  }

  // Normalizes a URL path (or route pattern) so route params and concrete
  // ids all collapse to '*': '/api/users/:id' ≡ '/api/users/${id}' ≡
  // '/api/users/42'. Returns null for anything that isn't an absolute path.
  function normalizePath(raw) {
    const p = (raw.split('?')[0] || '').trim();
    if (!p.startsWith('/')) return null;
    return p.split('/').map(seg => {
      if (!seg) return '';
      if (seg.startsWith(':')) return '*';
      if (seg.startsWith('{') && seg.endsWith('}')) return '*';
      if (seg.startsWith('${') && seg.endsWith('}')) return '*';
      if (/^\d+$/.test(seg)) return '*';
      if (/^[0-9a-f]{8,}$/i.test(seg)) return '*';
      return seg.toLowerCase();
    }).join('/');
  }

  // One-pass index: every quoted string/template literal in every symbol's
  // snippet that looks like an absolute path, keyed by its normalized form.
  // Built lazily on the first expansion, so projects where the user never
  // opens a route pay nothing.
  let pathIndex = null;
  function getPathIndex() {
    if (pathIndex) return pathIndex;
    const idx = new Map();
    const re = /['"`]([^'"`\n]{2,200})['"`]/g;
    for (let i = 0; i < DATA.symbols.length; i++) {
      const snip = DATA.symbols[i][5];
      if (!snip || snip.indexOf('/') === -1) continue;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(snip))) {
        const key = normalizePath(m[1]);
        if (!key || key === '/') continue;
        if (!idx.has(key)) idx.set(key, new Set());
        idx.get(key).add(i);
      }
    }
    pathIndex = idx;
    return idx;
  }

  // Frontend call sites for a route: symbols whose source contains a string
  // literal matching the route's normalized path. The handler itself and
  // anything else in its own file are excluded — that's the backend side.
  function findFrontendCallSites(r) {
    if (!r.path.includes('/')) return findResolverUsage(r);
    const key = normalizePath(r.path);
    if (!key) return [];
    const handlerFile = DATA.files[DATA.symbols[r.symId][4]][0];
    const sites = [];
    for (const id of getPathIndex().get(key) || []) {
      if (DATA.files[DATA.symbols[id][4]][0] === handlerFile) continue;
      sites.push(id);
      if (sites.length >= MAX_FRONTEND) break;
    }
    return sites.map(id => ({
      id,
      callers: (symInAdj.get(id) || []).slice(0, 3).map(([cid]) => cid),
    }));
  }

  // GraphQL resolvers (QUERY/MUTATION, path is a field name): match the
  // field name as a whole word anywhere in the codebase — that catches both
  // gql documents and generated-client calls. Full snippet scan, cached.
  const resolverUsageCache = new Map();
  function findResolverUsage(r) {
    if (resolverUsageCache.has(r.symId)) return resolverUsageCache.get(r.symId);
    const name = r.path.split('/').pop();
    const handlerFile = DATA.files[DATA.symbols[r.symId][4]][0];
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    const sites = [];
    for (let i = 0; i < DATA.symbols.length && sites.length < MAX_FRONTEND; i++) {
      if (DATA.files[DATA.symbols[i][4]][0] === handlerFile) continue;
      const snip = DATA.symbols[i][5];
      if (snip && re.test(snip)) sites.push(i);
    }
    const out = sites.map(id => ({
      id,
      callers: (symInAdj.get(id) || []).slice(0, 3).map(([cid]) => cid),
    }));
    resolverUsageCache.set(r.symId, out);
    return out;
  }

  // Small helpers for the template.
  function symName(id) { return DATA.symbols[id][0]; }
  function symKind(id) { return DATA.symbols[id][1]; }
  function symFile(id) { return displayName(DATA.files[DATA.symbols[id][4]][0]); }
  function symTitle(id) {
    const s = DATA.symbols[id];
    return `${s[1]} · ${DATA.files[s[4]][0]}:${s[2]}`;
  }

  // ---- P0: status/error matrix ----
  // Maps thrown error-class names to the status they almost always mean.
  const ERR_STATUS = [
    [/badrequest|invalidargument/i, 400], [/unauthorized|notauthenticated/i, 401],
    [/forbidden|accessdenied|insufficientpermissions/i, 403],
    [/notfound|nosuch|missing/i, 404], [/conflict|duplicate|alreadyexists/i, 409],
    [/gone/i, 410], [/payloadtoolarge|requesttoolarge/i, 413],
    [/validation|unprocessable|invalidinput/i, 422], [/ratelimit|toomanyrequests/i, 429],
    [/internal|servererror|unexpected/i, 500], [/notimplemented/i, 501],
    [/unavailable|serviceunavailable/i, 503],
  ];
  // NestJS/Express `HttpStatus.OK`-style symbolic status names → their code.
  // Most handlers write the enum member, not the bare number.
  const HTTP_STATUS_NAME = {
    OK: 200, CREATED: 201, ACCEPTED: 202, NO_CONTENT: 204,
    MOVED_PERMANENTLY: 301, FOUND: 302, NOT_MODIFIED: 304,
    BAD_REQUEST: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
    METHOD_NOT_ALLOWED: 405, NOT_ACCEPTABLE: 406, CONFLICT: 409, GONE: 410,
    PAYLOAD_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415,
    UNPROCESSABLE_ENTITY: 422, TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500, NOT_IMPLEMENTED: 501, BAD_GATEWAY: 502,
    SERVICE_UNAVAILABLE: 503, GATEWAY_TIMEOUT: 504,
  };
  // Scans the handler snippet (which, thanks to the decorator-widened
  // snippet capture, now includes its full `@Foo(...)` stack above the
  // declaration — not just its body) for every status code it can return:
  // `@HttpCode`/`@ResponseStatus` (numeric or `HttpStatus.NAME` symbolic),
  // explicit `.status(N)` calls, an implied 200 from a bare res.json(), and
  // thrown error classes (mapped to their conventional status, or listed as
  // a bare throw). Falls back to the structured `decorators` column too, for
  // indexers that do populate it.
  const statusCache = new Map();
  function scanStatuses(symId) {
    if (statusCache.has(symId)) return statusCache.get(symId);
    const s = DATA.symbols[findHandlerSymId(symId) ?? symId];
    const snip = s[5] || '';
    const codes = new Map(); // code -> { via }
    const add = (code, via) => { if (!codes.has(code)) codes.set(code, { via }); };
    const HTTPCODE_RE = /@?(?:HttpCode|ResponseStatus)\(\s*(?:(\d{3})|(?:HttpStatus|StatusCodes)\.([A-Z_]+))\s*\)/g;
    for (const d of (s[14] || [])) {
      HTTPCODE_RE.lastIndex = 0;
      const m = HTTPCODE_RE.exec(String(d));
      if (m) add(m[1] ? Number(m[1]) : HTTP_STATUS_NAME[m[2]], '@HttpCode');
    }
    let m;
    HTTPCODE_RE.lastIndex = 0;
    while ((m = HTTPCODE_RE.exec(snip))) {
      const code = m[1] ? Number(m[1]) : HTTP_STATUS_NAME[m[2]];
      if (code) add(code, '@HttpCode');
    }
    const STATUS_RE = /\.status\(\s*(?:(\d{3})|(?:HttpStatus|StatusCodes)\.([A-Z_]+))\s*\)/g;
    while ((m = STATUS_RE.exec(snip))) add(m[1] ? Number(m[1]) : HTTP_STATUS_NAME[m[2]], 'res.status');
    if (!codes.size && /(?:res|reply)\.json\(|NextResponse\.json\(|Response\.json\(|ctx\.json\(/.test(snip)) add(200, 'implied');
    const throws = [];
    const THROW_RE = /throw\s+new\s+([A-Z]\w+)/g;
    while ((m = THROW_RE.exec(snip))) {
      const cls = m[1];
      const hit = ERR_STATUS.find(([re]) => re.test(cls));
      if (hit) add(hit[1], cls);
      else if (!throws.includes(cls)) throws.push(cls);
    }
    const out = {
      statuses: [...codes.entries()].sort((a, b) => a[0] - b[0])
        .map(([code, { via }]) => ({ code, via })),
      throws,
    };
    statusCache.set(symId, out);
    return out;
  }

  // The leading `@Foo(...)`/`@Foo` block at the top of a snippet (decorators
  // only — stops at the first line that isn't part of one, i.e. the actual
  // declaration). Scanning just this instead of the whole snippet keeps
  // auth/status detection from tripping on unrelated body text (a variable
  // named `permission`, the word "protected" in a comment, etc).
  function leadingDecoratorText(snip) {
    const lines = (snip || '').split('\n');
    let depth = 0, end = 0;
    for (; end < lines.length; end++) {
      const line = lines[end];
      if (depth === 0 && !line.trim().startsWith('@')) break;
      for (const c of line) {
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth--;
      }
    }
    return lines.slice(0, end).join('\n');
  }
  // Class-level decorators (`@UseGuards(...)` on the controller itself)
  // apply to every method in it — found by walking back to the nearest
  // preceding class/component node in the same file.
  function enclosingClassDecoratorText(symId) {
    const fileIdx = DATA.symbols[symId][4];
    for (let i = symId - 1; i >= 0; i--) {
      const sym = DATA.symbols[i];
      if (sym[4] !== fileIdx) break;
      if (sym[1] === 'class' || sym[1] === 'component') return leadingDecoratorText(sym[5] || '');
    }
    return '';
  }
  // ---- P0: auth detection ----
  // Returns { level: 'public' | 'guarded', via } or null when nothing
  // auth-shaped is visible on the handler (unknown — no badge shown).
  const authCache = new Map();
  function authInfo(symId) {
    if (authCache.has(symId)) return authCache.get(symId);
    const handlerId = findHandlerSymId(symId) ?? symId;
    const s = DATA.symbols[handlerId];
    const decors = (s[14] || []).map(String);
    const dec = decors.join(' ');
    const snip = s[5] || '';
    const ownDecoratorText = leadingDecoratorText(snip);
    let out = null;
    // A method-level @Public() (or equivalent) conventionally overrides any
    // class-level guard, so it's checked first and alone.
    if (/(^|[^A-Za-z])@?Public\b/.test(`${dec} ${ownDecoratorText}`)) out = { level: 'public', via: '@Public' };
    if (!out) {
      const guardText = `${dec} ${ownDecoratorText} ${enclosingClassDecoratorText(handlerId)}`;
      const gm = /@?(UseGuards|AuthGuard|Roles|Permissions|RequireAuth|Authorized|Protected|ApiBearerAuth|ApiSecurity|ApiOAuth2|ApiKeyAuth)\b/i.exec(guardText);
      if (gm) out = { level: 'guarded', via: gm[1] };
    }
    if (!out) {
      if (/(?:req|request|ctx)\.user\b|\bBearer\b|\bJWT\b|verifyToken|requireAuth|isAuthenticated|currentUser|getUserFromRequest/.test(snip)) {
        out = { level: 'guarded', via: 'handler code' };
      }
    }
    authCache.set(symId, out);
    return out;
  }

  // ---- P0: copyable curl/GraphQL skeleton ----
  // Placeholder value for a parsed field type, used in the curl body.
  function placeholderFor(type) {
    if (type === 'string' || /string/.test(type)) return 'string';
    if (type === 'number' || type === 'bigint' || /number/.test(type)) return 0;
    if (type === 'boolean' || /boolean/.test(type)) return true;
    if (/\[\]$/.test(type)) return [];
    return null;
  }
  // Builds a runnable request skeleton for the route. Body fields come from
  // the parsed schemas: a referenced zod schema first (that IS the wire
  // format), then a DTO-named type, then plain req.body destructuring names.
  // Without any of those, no -d is emitted — an omitted body beats a
  // placeholder-soup body.
  function requestSkeleton(r, d) {
    if (r.method === 'QUERY' || r.method === 'MUTATION') {
      const verb = r.method === 'QUERY' ? 'query' : 'mutation';
      return `# GraphQL ${verb}\n${verb} {\n  ${r.path.split('/').pop()}\n}`;
    }
    if (r.method === 'WS') return `# WebSocket gateway: ${r.path}`;
    const path = r.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    const lines = [`curl -X ${r.method} 'http://localhost:3000${path}'`];
    if (r.method === 'POST' || r.method === 'PUT' || r.method === 'PATCH') {
      lines.push(`  -H 'Content-Type: application/json'`);
      let fields = null;
      const zod = d.request.find(sch => sch.source === 'zod' && sch.fields.length);
      if (zod) fields = Object.fromEntries(zod.fields.map(f => [f.name, placeholderFor(f.type)]));
      if (!fields) {
        const dto = d.request.find(sch => sch.source === 'type' && sch.fields.length);
        if (dto) fields = Object.fromEntries(dto.fields.map(f => [f.name, placeholderFor(f.type)]));
      }
      if (!fields && d.destructure.length) fields = Object.fromEntries(d.destructure.map(n => [n, '…']));
      if (fields && Object.keys(fields).length) lines.push(`  -d '${JSON.stringify(fields)}'`);
    }
    return lines.join(' \\\n');
  }
  let copiedSymId = null;
  let copiedTimer = null;
  async function copySkeleton(r, d) {
    const text = requestSkeleton(r, d);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    copiedSymId = r.symId;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => { copiedSymId = null; }, 1500);
  }

  // ---- P0: orphan-endpoint counts ----
  // Fills feCounts for every route once the snippet path index exists. Run
  // at idle so opening the view never blocks on a full-codebase scan.
  onMount(() => {
    const run = () => {
      const counts = new Map();
      for (const r of routes) counts.set(r.symId, findFrontendCallSites(r).length);
      feCounts = counts;
    };
    const ric = window.requestIdleCallback || ((fn) => setTimeout(fn, 150));
    ric(run);
  });
</script>

<div class="routes">
  <div class="head">
    <div>
      <h1>API surface</h1>
      <p class="sub">Every route CodeGraph found — REST handlers, GraphQL resolvers, WebSocket gateways. Click a route for its handler, response codes, the schemas it touches, and which frontend code calls it.</p>
    </div>
    <div class="head-controls">
      <div class="search-wrap">
        <input
          type="text"
          placeholder="Filter by method or path… (↑↓ to pick)"
          bind:value={query}
          on:focus={() => showSuggest = true}
          on:blur={() => setTimeout(() => { showSuggest = false; focusedSug = -1; }, 120)}
          on:input={() => { focusedSug = -1; showSuggest = true; }}
          on:keydown={onSearchKey}
        />
        {#if showSuggest && suggestions.length}
          <div class="suggest">
            {#each suggestions as r, i (r.symId)}
              <button
                class="suggest-row"
                class:active={i === focusedSug}
                on:mousedown|preventDefault={() => pickSuggestion(r)}
                on:mousemove={() => { if (focusedSug !== i) focusedSug = i; }}
              >
                <span class="method mono" style="color:{METHOD_COLOR[r.method] || 'var(--accent)'}">{r.method}</span>
                <span class="mono sug-path">{r.path}</span>
                <span class="sug-file">{displayName(r.filePath)}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <div class="method-mini">
        {#each methods as m (m)}
          <button
            class="method-mini-btn"
            class:active={methodFilter === m}
            style={methodFilter === m ? `background:${METHOD_COLOR[m] || 'var(--accent)'};border-color:${METHOD_COLOR[m] || 'var(--accent)'}` : ''}
            on:click={() => methodFilter = methodFilter === m ? null : m}
          >{m}</button>
        {/each}
        {#each versions as v (v)}
          <button
            class="method-mini-btn ver-btn"
            class:active={versionFilter === v}
            data-tip="Only routes under this version prefix"
            on:click={() => versionFilter = versionFilter === v ? null : v}
          >{v}</button>
        {/each}
        <button
          class="method-mini-btn orphan-btn"
          class:active={orphansOnly}
          disabled={!feCounts}
          data-tip="Only routes with no frontend call sites — dead API surface (dynamic URLs won't match)"
          on:click={() => orphansOnly = !orphansOnly}
        >orphan{feCounts ? ` ${routes.filter(r => !(feCounts.get(r.symId) || 0)).length}` : '…'}</button>
        {#if hasDiffData}
          <button
            class="method-mini-btn chg-btn"
            class:active={changedOnly}
            data-tip="Only routes whose handler file changed since {DATA.changedRef || 'the diff ref'}"
            on:click={() => changedOnly = !changedOnly}
          >∆ {changedCount}</button>
        {/if}
        <button
          class="method-mini-btn oa-btn"
          data-tip="Download the inferred surface as OpenAPI 3.1 JSON — heuristic fields carry x-inferred markers"
          on:click={exportOpenApi}
        >⇩ openapi</button>
        <span class="group-toggle">
          <button class:active={groupMode === 'controller'} on:click={() => groupMode = 'controller'}>controller</button>
          <button class:active={groupMode === 'resource'} on:click={() => groupMode = 'resource'}>resource</button>
        </span>
      </div>
    </div>
  </div>

  <div class="rows">
    {#each byController as g (g.key)}
      <div class="controller-group">
        <div class="controller-head">
          {#if groupMode === 'controller'}
            <span class="pkg-dot" style="background:{pkgColor(g.pkgIdx)}"></span>
            <span class="mono controller-name" data-tip={g.key}>{displayName(g.key)}</span>
          {:else}
            <span class="mono controller-name resource-name">{g.key}</span>
          {/if}
          <span class="controller-count">{g.routes.length}</span>
        </div>
        {#each g.routes as r (r.symId)}
          <button
            class="route-row"
            aria-expanded={expanded.has(r.symId)}
            on:click={() => toggleExpand(r.symId)}
          >
            <span class="chev" class:open={expanded.has(r.symId)}>▸</span>
            <span class="method mono" style="color:{METHOD_COLOR[r.method] || 'var(--accent)'}">{r.method}</span>
            <span class="path mono">{#if changedSymIds.has(r.symId)}<em class="chg" data-tip="Handler file changed since {DATA.changedRef || 'diff ref'}">∆</em>{/if}{r.path}</span>
            <span class="line mono">:{r.startLine}</span>
            {#if authInfo(r.symId)}
              <span class="auth" class:guarded={authInfo(r.symId).level === 'guarded'} data-tip="Auth: {authInfo(r.symId).level} ({authInfo(r.symId).via})">{authInfo(r.symId).level === 'guarded' ? '🔒' : '○'}</span>
            {:else}
              <span class="auth" data-tip="No auth signal found on this handler">·</span>
            {/if}
            <span class="fe" data-tip="Frontend call sites (0 = orphan endpoint)">{feCounts ? (feCounts.get(r.symId) || 0) : '…'}</span>
            <span class="callees" data-tip="downstream calls from this handler">{r.calleeCount} calls</span>
            <span
              class="row-btn"
              role="button"
              tabindex="0"
              on:click|stopPropagation={() => openAllFlows(r.symId)}
              on:keydown|stopPropagation={(e) => { if (e.key === 'Enter') openAllFlows(r.symId); }}
              data-tip="Enumerate every path through this handler"
            >all →</span>
          </button>
          {#if expanded.has(r.symId)}
            {@const d = routeDetail(r)}
            {@const st = scanStatuses(r.symId)}
            {@const au = authInfo(r.symId)}
            <div class="route-detail">
              <div class="detail-head">
                {#if d.signature}<code class="sig mono">{d.signature}</code>{/if}
                {#each d.badges as b (b)}<span class="badge">{b}</span>{/each}
                {#if versionOf(r.path)}<span class="badge ver-badge">{versionOf(r.path)}</span>{/if}
                {#if au}<span class="badge auth-badge" class:guarded={au.level === 'guarded'}>{au.level === 'guarded' ? '🔒' : '○'} {au.level} · {au.via}</span>{/if}
                <button class="copy-btn" data-tip="Copy a runnable request skeleton" on:click={() => copySkeleton(r, d)}>
                  {copiedSymId === r.symId ? 'copied ✓' : 'copy request'}
                </button>
                <button class="file-link" data-tip={symTitle(r.symId)} on:click={() => jumpToSymbol(r.symId)}>open in file →</button>
              </div>
              {#if d.doc}<p class="doc">{d.doc}</p>{/if}
              <div class="status-row">
                <h4>Responses</h4>
                {#if st.statuses.length || st.throws.length}
                  <div class="status-chips">
                    {#each st.statuses as s (s.code)}
                      <span
                        class="status-chip"
                        class:s2={s.code < 300}
                        class:s4={s.code >= 400 && s.code < 500}
                        class:s5={s.code >= 500}
                        data-tip="{s.code} via {s.via}"
                      >{s.code}{#if s.via !== 'res.status' && s.via !== 'implied' && s.via !== '@HttpCode'} <em>{s.via}</em>{/if}</span>
                    {/each}
                    {#each st.throws as cls (cls)}
                      <span class="status-chip throw" data-tip="thrown without a mapped status — likely 4xx/5xx">throw {cls}</span>
                    {/each}
                  </div>
                {:else}
                  <p class="empty-col">No explicit status codes or throws found in this handler — a bare res.json() is assumed 200.</p>
                {/if}
              </div>
              <div class="cols">
                <div class="col">
                  <h4>Calls <span class="col-count">{d.callees.length}</span></h4>
                  {#if d.callees.length}
                    <div class="chips">
                      {#each d.callees as c (c.id)}
                        <button class="chip" data-tip={symTitle(c.id)} on:click={() => jumpToSymbol(c.id)}>
                          {symName(c.id)}
                          {#if c.w > 1}<span class="chip-w">×{c.w}</span>{/if}
                        </button>
                      {/each}
                    </div>
                  {:else}
                    <p class="empty-col">No direct calls found.</p>
                  {/if}
                </div>
                <div class="col">
                  <h4>Request shape <span class="col-count">{d.request.length}</span></h4>
                  {#if d.request.length}
                    {#each d.request as t (t.name)}
                      {@const rawId = `raw-${r.symId}-${t.name}`}
                      <div class="type-block">
                        <div class="type-head">
                          <span class="prov" class:prov-zod={t.source === 'zod'} data-tip="{t.source === 'zod' ? 'zod schema — this is the wire format (high confidence)' : 'DTO/type — exact shape, matched via ' + t.via}">{t.source === 'zod' ? 'zod' : 'type'}</span>
                          <span class="mono type-name">{t.name}</span>
                          {#if t.tid != null}<button class="type-jump" data-tip={symTitle(t.tid)} on:click={() => jumpToSymbol(t.tid)}>→ file</button>{/if}
                        </div>
                        {#if t.fields.length}
                          <table class="field-table">
                            <tbody>
                              {#each t.fields as f (f.name)}
                                <tr>
                                  <td class="mono fn">{f.name}{#if !f.required}<span class="opt" data-tip="optional">?</span>{/if}</td>
                                  <td class="mono ft">{f.type}</td>
                                </tr>
                              {/each}
                            </tbody>
                          </table>
                        {:else}
                          <pre class="mono type-snippet">{t.snippet}</pre>
                        {/if}
                        <button class="raw-toggle" aria-expanded={rawOpen[rawId] === true} on:click={() => rawOpen[rawId] = !(rawOpen[rawId])}>
                          {rawOpen[rawId] ? 'hide raw' : 'raw source'}
                        </button>
                        {#if rawOpen[rawId]}<pre class="mono type-snippet">{t.snippet}</pre>{/if}
                      </div>
                    {/each}
                  {:else if d.destructure.length}
                    <p class="empty-col">No schema found. Body fields destructured in the handler: <span class="mono">{d.destructure.join(', ')}</span></p>
                  {:else if d.paramNames.length}
                    <p class="empty-col">No schema resolved for params: <span class="mono">{d.paramNames.join(', ')}</span></p>
                  {:else}
                    <p class="empty-col">No request body — {r.method} takes no typed payload.</p>
                  {/if}
                </div>
                <div class="col">
                  <h4>Response shape <span class="col-count">{d.response.length}</span></h4>
                  {#if d.response.length}
                    {#each d.response as t (t.name)}
                      {#if t.source === 'json'}
                        <div class="type-block">
                          <div class="type-head">
                            <span class="prov prov-json" data-tip="Top-level keys of the res.json object literal in the handler">json</span>
                            <span class="mono type-name">res.json keys</span>
                          </div>
                          <div class="json-keys">
                            {#each t.keys as k (k)}<span class="jk mono">{k}</span>{/each}
                          </div>
                        </div>
                      {:else}
                        {@const rawId = `raw-${r.symId}-${t.name}`}
                        <div class="type-block">
                          <div class="type-head">
                            <span class="prov" class:prov-zod={t.source === 'zod'} data-tip="{t.source === 'zod' ? 'zod schema — this is the wire format (high confidence)' : 'DTO/type — exact shape, matched via ' + t.via}">{t.source === 'zod' ? 'zod' : 'type'}</span>
                            <span class="mono type-name">{t.name}</span>
                            {#if t.tid != null}<button class="type-jump" data-tip={symTitle(t.tid)} on:click={() => jumpToSymbol(t.tid)}>→ file</button>{/if}
                          </div>
                          {#if t.fields.length}
                            <table class="field-table">
                              <tbody>
                                {#each t.fields as f (f.name)}
                                  <tr>
                                    <td class="mono fn">{f.name}{#if !f.required}<span class="opt" data-tip="optional">?</span>{/if}</td>
                                    <td class="mono ft">{f.type}</td>
                                  </tr>
                                {/each}
                              </tbody>
                            </table>
                          {:else}
                            <pre class="mono type-snippet">{t.snippet}</pre>
                          {/if}
                          <button class="raw-toggle" aria-expanded={rawOpen[rawId] === true} on:click={() => rawOpen[rawId] = !(rawOpen[rawId])}>
                            {rawOpen[rawId] ? 'hide raw' : 'raw source'}
                          </button>
                          {#if rawOpen[rawId]}<pre class="mono type-snippet">{t.snippet}</pre>{/if}
                        </div>
                      {/if}
                    {/each}
                  {:else}
                    <p class="empty-col">No response shape found — no return type, constructed type, or res.json literal resolves to a known schema.</p>
                  {/if}
                </div>
                <div class="col">
                  <h4>Frontend usage <span class="col-count">{d.frontend.length}</span> <span class="prov-label" data-tip="Matched by scanning source snippets for the route path — heuristic; dynamic URLs won't match">inferred</span></h4>
                  {#if d.frontend.length}
                    {#each d.frontend as f (f.id)}
                      <div class="fe-site">
                        <button class="fe-name" data-tip={symTitle(f.id)} on:click={() => jumpToSymbol(f.id)}>
                          <span class="mono">{symName(f.id)}</span>
                          <span class="fe-meta">{symKind(f.id)} · {symFile(f.id)}</span>
                        </button>
                        {#if f.callers.length}
                          <div class="fe-callers">
                            used by
                            {#each f.callers as cid, i (cid)}
                              {#if i > 0}<span class="sep">, </span>{/if}
                              <button class="fe-caller" data-tip={symTitle(cid)} on:click={() => jumpToSymbol(cid)}>{symName(cid)}</button>
                            {/each}
                          </div>
                        {/if}
                      </div>
                    {/each}
                  {:else}
                    <p class="empty-col">No frontend call site found for this path — dynamically built URLs or generated clients won't match.</p>
                  {/if}
                </div>
              </div>
            </div>
          {/if}
        {/each}
      </div>
    {/each}
    {#if totalShown === 0}
      <div class="empty">No routes match the current filters.</div>
    {/if}
  </div>
</div>

<style>
  .routes {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    font-family: var(--vscode-font-family, 'Manrope', sans-serif);
    color: var(--text);
  }
  .mono { font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); }
  .head {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .head h1 { margin: 0; font-size: 18px; }
  .head .sub { margin: 4px 0 0 0; color: var(--muted); font-size: 12px; line-height: 1.4; max-width: 620px; }
  .head-controls { display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
  .search-wrap { position: relative; }
  .suggest {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    width: 340px;
    max-height: 260px;
    overflow-y: auto;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    z-index: 50;
    padding: 4px;
  }
  .suggest-row {
    display: grid;
    grid-template-columns: 56px 1fr auto;
    align-items: center;
    gap: 8px;
    width: 100%;
    background: none;
    border: none;
    border-radius: 6px;
    padding: 5px 8px;
    text-align: left;
    cursor: pointer;
    font-size: 11.5px;
    color: var(--text);
    font-family: inherit;
  }
  .suggest-row.active, .suggest-row:hover { background: var(--accent-soft); }
  .suggest-row .method { font-weight: 700; font-size: 10px; }
  .suggest-row .sug-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .suggest-row .sug-file { color: var(--muted); font-size: 10px; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ver-btn { color: #a367c9; }
  .ver-btn.active { background: #a367c9; border-color: #a367c9; color: white; }
  .oa-btn { color: var(--accent); }
  .oa-btn:hover { color: var(--text); }
  .badge.ver-badge { color: #a367c9; border-color: rgba(163, 103, 201, 0.4); }
  .head input {
    background: var(--surface-2); border: 1px solid var(--border); color: var(--text);
    border-radius: 6px; padding: 6px 10px;
    font-family: inherit; font-size: 12.5px; width: 240px; outline: none;
  }
  .head input:focus { border-color: var(--accent); }
  .method-mini { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; max-width: 320px; }
  .method-mini-btn {
    background: var(--surface-2); color: var(--muted); border: 1px solid var(--border);
    border-radius: 12px; padding: 2px 8px; font-size: 10px;
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace); font-weight: 700; cursor: pointer;
  }
  .method-mini-btn:hover { color: var(--text); }
  .method-mini-btn.active { color: white; }

  .rows { overflow-y: auto; flex: 1; padding-bottom: 12px; }
  .controller-group { border-bottom: 1px solid var(--border); }
  .controller-head {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 18px;
    background: var(--surface-2);
    position: sticky; top: 0;
  }
  .pkg-dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
  .controller-name { font-size: 12px; font-weight: 700; }
  .controller-count {
    margin-left: auto;
    color: var(--muted);
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    font-size: 11px;
  }
  .route-row {
    display: grid;
    grid-template-columns: 18px 64px 1fr 50px 24px 46px 96px 50px;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px 18px;
    background: none;
    border: none;
    border-top: 1px solid var(--border);
    text-align: left;
    cursor: pointer;
    font-size: 12.5px;
    color: var(--text);
  }
  .route-row:hover { background: var(--accent-soft); }
  .route-row .chev {
    color: var(--muted);
    font-size: 10px;
    transition: transform 0.12s ease;
  }
  .route-row .chev.open { transform: rotate(90deg); color: var(--accent); }
  .route-row .method { font-weight: 700; font-size: 11px; }
  .route-row .path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .route-row .line { color: var(--muted); font-size: 11px; }
  .route-row .auth {
    text-align: center;
    font-size: 11px;
    color: var(--muted);
  }
  .route-row .auth.guarded { color: #c9a13f; }
  .route-row .fe {
    text-align: right;
    color: var(--muted);
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    font-size: 11px;
  }
  .route-row .callees { color: var(--muted); font-size: 10.5px; text-align: right; white-space: nowrap; }
  .route-row .row-btn {
    color: var(--accent);
    font-size: 10.5px; font-weight: 700;
    text-align: right;
    cursor: pointer;
  }
  .route-row .row-btn:hover { text-decoration: underline; }
  .empty { padding: 30px; text-align: center; color: var(--muted); font-size: 13px; }
  .orphan-btn { color: var(--danger); border-color: var(--border); }
  .orphan-btn.active { background: var(--danger); border-color: var(--danger); color: white; }
  .orphan-btn:disabled { opacity: 0.5; cursor: default; }
  .chg-btn { color: #c9a13f; border-color: var(--border); }
  .chg-btn.active { background: #c9a13f; border-color: #c9a13f; color: white; }
  .path .chg {
    font-style: normal;
    color: #c9a13f;
    font-weight: 700;
    margin-right: 4px;
    cursor: help;
  }
  .group-toggle {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    margin-left: 4px;
  }
  .group-toggle button {
    background: var(--surface-2); color: var(--muted); border: none;
    padding: 2px 8px; font-size: 10px; cursor: pointer;
    font-family: var(--vscode-font-family, 'Manrope', sans-serif);
  }
  .group-toggle button.active { background: var(--accent); color: white; }
  .controller-head .resource-name { color: var(--accent); }
  .prov {
    text-transform: uppercase;
    font-size: 8.5px;
    letter-spacing: 0.06em;
    font-weight: 700;
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 4px;
    cursor: help;
  }
  .prov.prov-zod { color: #3fa77f; border-color: rgba(63, 167, 127, 0.4); }
  .prov.prov-json { color: #c9a13f; border-color: rgba(201, 161, 63, 0.4); }
  .json-keys { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 8px; }
  .jk {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 1px 6px;
    font-size: 10px;
    color: var(--text);
  }
  .prov-label {
    font-size: 8.5px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    font-weight: 400;
    cursor: help;
  }
  .field-table { width: 100%; border-collapse: collapse; }
  .field-table td {
    padding: 2px 10px;
    font-size: 10.5px;
    border-top: 1px solid var(--border);
    vertical-align: top;
  }
  .field-table tr:first-child td { border-top: none; }
  .field-table .fn { color: var(--text); font-weight: 600; }
  .field-table .fn .opt { color: var(--muted); cursor: help; }
  .field-table .ft { color: var(--muted); text-align: right; word-break: break-all; }
  .raw-toggle {
    display: block;
    width: 100%;
    background: var(--surface-2); border: none; border-top: 1px solid var(--border);
    color: var(--muted); font-size: 9.5px; padding: 3px 0;
    cursor: pointer; font-family: inherit;
  }
  .raw-toggle:hover { color: var(--accent); }

  /* ---- inline detail panel ---- */
  .route-detail {
    padding: 12px 18px 14px 50px;
    border-top: 1px solid var(--border);
    background: var(--surface);
  }
  .detail-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .sig {
    color: var(--text);
    font-size: 11.5px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 3px 8px;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    color: var(--muted);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 5px;
    font-size: 9.5px;
  }
  .badge.auth-badge.guarded { color: #c9a13f; border-color: #c9a13f; }
  .copy-btn {
    background: var(--surface-2); border: 1px solid var(--border);
    border-radius: 6px; padding: 2px 10px;
    color: var(--text); font-size: 11px; font-weight: 600;
    cursor: pointer; font-family: inherit;
  }
  .copy-btn:hover { border-color: var(--accent); color: var(--accent); }
  .status-row { margin-top: 10px; }
  .status-row h4 {
    margin: 0 0 5px 0;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  .status-chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .status-chip {
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
    font-size: 10.5px;
    font-weight: 700;
    border-radius: 5px;
    padding: 2px 7px;
    border: 1px solid var(--border);
    color: var(--muted);
    cursor: help;
  }
  .status-chip em { font-style: normal; font-weight: 400; font-size: 9.5px; }
  .status-chip.s2 { color: #3fa77f; border-color: rgba(63, 167, 127, 0.4); }
  .status-chip.s4 { color: #c9a13f; border-color: rgba(201, 161, 63, 0.4); }
  .status-chip.s5, .status-chip.throw { color: #c94f7c; border-color: rgba(201, 79, 124, 0.4); }
  .file-link {
    margin-left: auto;
    background: none; border: none;
    color: var(--accent);
    font-size: 11px; font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .file-link:hover { text-decoration: underline; }
  .doc { margin: 8px 0 0 0; color: var(--muted); font-size: 12px; line-height: 1.45; max-width: 760px; }
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
    gap: 14px;
    margin-top: 12px;
  }
  .col h4 {
    margin: 0 0 6px 0;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  .col-count {
    color: var(--accent);
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
  }
  .empty-col { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.4; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip {
    background: var(--surface-2); border: 1px solid var(--border);
    border-radius: 6px; padding: 2px 8px;
    color: var(--text); font-size: 11px; cursor: pointer;
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
  }
  .chip:hover { border-color: var(--accent); color: var(--accent); }
  .chip-w { color: var(--muted); margin-left: 4px; font-size: 9.5px; }
  .type-block {
    border: 1px solid var(--border);
    border-radius: 8px;
    margin-bottom: 8px;
    overflow: hidden;
  }
  .type-head {
    display: flex; align-items: center; gap: 8px;
    padding: 4px 8px;
    background: var(--surface-2);
  }
  .type-name { font-size: 11px; font-weight: 700; }
  .type-jump {
    margin-left: auto;
    background: none; border: none;
    color: var(--accent); font-size: 10px; font-weight: 600;
    cursor: pointer; font-family: inherit;
  }
  .type-jump:hover { text-decoration: underline; }
  .type-snippet {
    margin: 0;
    padding: 8px 10px;
    font-size: 10.5px;
    line-height: 1.45;
    color: var(--text);
    max-height: 170px;
    overflow: auto;
    white-space: pre;
  }
  .fe-site { margin-bottom: 8px; }
  .fe-name {
    display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
    background: none; border: none; padding: 0;
    color: var(--text); cursor: pointer; text-align: left;
    font-family: inherit; font-size: 11.5px;
  }
  .fe-name:hover { color: var(--accent); }
  .fe-meta { color: var(--muted); font-size: 10px; }
  .fe-callers { color: var(--muted); font-size: 10.5px; line-height: 1.6; }
  .fe-caller {
    background: none; border: none; padding: 0;
    color: var(--accent); font-size: 10.5px; cursor: pointer;
    font-family: var(--vscode-editor-font-family, 'JetBrains Mono', monospace);
  }
  .fe-caller:hover { text-decoration: underline; }
  .fe-callers .sep { color: var(--muted); }
</style>
