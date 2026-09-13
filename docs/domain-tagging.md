# Tagging domains in docstrings

Domain View (the "Domains" nav item) groups your codebase into business/feature
domains so you can browse by "what this does" instead of "where it lives."
By default it does this the only way it safely can without reading your
mind: truncating each package's folder path to N segments and grouping
packages that share a prefix. That's structurally sound but semantically
blind — `payments/stripe` and `billing/invoices` might be the same business
domain and never group together, while two unrelated tools that happen to
share a folder prefix will.

You can override this per-symbol with two tags in a docstring. No schema
change, no re-index config — the indexer already exports full docstring
text, tags are just text you write.

## The format

```js
/**
 * Creates a Stripe checkout session for the cart and redirects to the
 * hosted payment page.
 *
 * @domain Billing
 * @flow Checkout
 */
export function startCheckout(cart) { ... }
```

| Tag | Required | Meaning |
| --- | --- | --- |
| `@domain <Name>` | Yes, to opt in | The business/feature domain this symbol belongs to. Use the same string everywhere it applies — it's a literal grouping key, not fuzzy-matched. Prefer a name a product person would recognize ("Billing"), not an implementation name ("payments-service-v2"). |
| `@flow <Name>` | No | The specific flow inside that domain (e.g. "Checkout" vs. "Refund" inside "Billing"). Shown as a sub-label on the entry-point card. Omit it if the symbol doesn't belong to a named flow. |

Rules that make this safe to adopt incrementally:

- **Only tag entry points.** Domain View only ever lists symbols Domain View
  already classifies as entry points (exported with no internal callers, or
  matching a framework marker like a route handler or lifecycle hook —
  see `isEntryPoint` in `app/src/lib/graph.js`). Tagging a private helper
  does nothing; it's never shown standalone.
- **One line, exact tag keyword.** The tag must be the entire content of its
  own line (leading `*`/`//` and whitespace are fine): `@domain Billing`.
  `@domain` matching is case-insensitive; the name after it is taken
  verbatim, trimmed.
- **Untagged code keeps working exactly as before.** Nothing is required.
  A symbol without `@domain` falls back to folder-depth grouping, same as
  today. Tagging is additive — you can annotate one entry point and ship it.
- **Reuse the same `@domain` name across files/packages** you want folded
  together. That's the entire mechanism — there's no separate domain
  registry to keep in sync.
- **Known limitation:** the indexer currently does not extract docstrings
  for Svelte component symbols (any `.svelte` file's top-of-`<script>`
  comment), regardless of comment style. Tags on a `.svelte` component are
  silently ignored today — tag the plain functions it calls into instead,
  or a sibling `.js`/`.ts` entry point, until that's fixed upstream in the
  indexer.

## Worked example (from this repo)

```ts
// extension/src/extension.ts
/**
 * Registers the extension's commands with VS Code on activation.
 *
 * @domain VS Code Extension
 * @flow Activation
 */
export function activate(context: vscode.ExtensionContext) { ... }

/**
 * No-op lifecycle hook required by VS Code's extension API.
 *
 * @domain VS Code Extension
 * @flow Deactivation
 */
export function deactivate() {}
```

```js
// app/src/main.js
/**
 * Mounts the root Svelte component into the page's #app element.
 *
 * @domain Web App Bootstrap
 * @flow Startup
 */
```

Both `activate` and `deactivate` fold into one "VS Code Extension" domain in
the rail, each showing its own `@flow` sub-label, while `app`'s bootstrap
gets its own "Web App Bootstrap" domain — none of which folder-depth
grouping alone would have produced (they're not path-adjacent).

## LLM prompt: auto-tag your codebase

Paste this into your coding assistant (Claude Code, Cursor, etc.) pointed at
your own repo. It's written to be conservative — it asks the model to
propose tags for review rather than blindly rewrite files, and to reuse
domain names instead of inventing near-duplicates.

````
You are adding `@domain` / `@flow` tags to docstrings in this codebase so a
tool (CodeGraph Explorer's Domain View) can group entry points by business
domain instead of folder path. Follow this exactly:

1. Find candidate symbols: exported functions/methods/classes with no
   internal callers (route handlers, CLI commands, message/event handlers,
   scheduled jobs, GraphQL resolvers, React/Vue/Svelte page-level
   components if your indexer supports it, background workers, webhook
   receivers) — i.e. things a user or another system calls INTO, not
   internal helpers.

2. For each candidate, add (or extend) a docstring comment directly above
   it in this exact format:

   /**
    * <existing or new one-line description of what it does>
    *
    * @domain <Domain Name>
    * @flow <Flow Name>       (optional — omit if there's no distinct named flow)
    */

   Rules:
   - `@domain` and `@flow` must each be the entire content of their own
     comment line.
   - Reuse an EXACT existing `@domain` name whenever the symbol clearly
     belongs to a domain you've already tagged elsewhere in this pass —
     do not create "Billing" and "Billing Service" as two domains. Before
     tagging, grep the codebase for existing `@domain` tags and build a
     list of names already in use; prefer reusing one of those.
   - Domain names should be product/business language a non-engineer would
     recognize ("Billing", "Search", "Onboarding"), not implementation
     names ("payments-svc", "es-indexer").
   - Flow names should be the specific user-facing action ("Checkout",
     "Refund", "Password reset"), not a technical step ("validateInput").
   - Do not tag private/internal helper functions, utility functions, or
     anything already called by other code in this codebase — only true
     entry points.
   - Do not remove or rewrite existing docstring prose — only add the tag
     lines, and only add a description if the symbol has no docstring at
     all yet.
   - Preserve each file's existing comment style (`/** */` JSDoc vs. `#`
     vs. `//`) — just add `@domain`/`@flow` as new lines within it. Note:
     if this is a Svelte/Vue single-file component and your target is the
     CodeGraph indexer specifically, tag a plain function/module the
     component calls into instead, since component-level comments aren't
     currently extracted as docstrings by that indexer.

3. Before writing any files, output a table of every symbol you plan to
   tag: file:line, symbol name, proposed @domain, proposed @flow. Group by
   domain so I can sanity-check that the grouping makes sense and catch any
   near-duplicate domain names before you touch a single file.

4. Only after I confirm the table, apply the edits.
````

## Where this is implemented

- Tag parsing: `parseDocTags` in `app/src/lib/graph.js`.
- Grouping/display: `app/src/lib/DomainView.svelte` — tagged entry points
  render under an "@domain tagged" section above the folder-depth groups;
  untagged entry points keep appearing under folder-depth groups exactly as
  before.
