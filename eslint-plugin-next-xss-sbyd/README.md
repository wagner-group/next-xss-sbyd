# eslint-plugin-next-xss-sbyd

This plugin reports unsafe HTML insertion, resource loading, and HTTP response APIs.
Its recommended preset directs application code to `next-xss-sbyd`'s safe APIs and
requires `next-xss-sbyd`'s runtime checks.

The rules use TypeScript information about expression types and imports. Linting
stops with a configuration error if the parser cannot supply it.

Use the latest patch release of Node.js 22 (22.13.0 or later), 24, or 26,
as required by the runtime. Upgrade unsupported Node.js versions before migration.

## Configuration

```js
import xssSbyd from "eslint-plugin-next-xss-sbyd";

export default [...xssSbyd.configs.recommended];
```

Install a compatible `next-xss-sbyd` runtime alongside the plugin: it is a required
peer dependency so lint and runtime resolve the same passive policy. A missing
runtime causes module resolution to fail; install it in the lint workspace too.

Applications must have a `tsconfig.json` discoverable by
`@typescript-eslint/parser` project service. The preset excludes `.next`,
`node_modules`, `dist`, `build`, `coverage`, and `*.generated.*` files.

For a lint-guided source migration, use `xssSbyd.configs.lintMigration`. It
preserves the recommended security rules and options at warning severity while
retaining the `xss-sbyd/lint-migration` flat-config name and error-level
disable-justification enforcement. This preset changes ESLint severity only. It does
not relax runtime enforcement or make partially migrated code runnable; rendered
pages and tests can still throw until their findings are fixed. The
[retrofit guide](../docs/retrofit.md#1-install-and-inventory) documents a warning
limit enforced by continuous integration (CI), lowered as findings are fixed,
and the switch to runtime enforcement and `recommended`. Do not ship with the
lint migration preset.

## Optional Markdown migration

Add `...xssSbyd.configs.markdownMigration` after `lintMigration` while inventorying
Markdown use, or `...xssSbyd.configs.markdown` after `recommended` for errors.
Neither is included in the base presets. These rules check imports without
requiring type services; the base preset's other rules retain their type setup.
Set `"next-xss-sbyd": {"markdown": true}` in the application's package.json to
make `check-config` verify both optional rules at the selected stage's severity.
`audit --recommended` also includes Markdown rules when that setting is selected.

The Markdown inventory runs during audit and can be inspected directly with
`node node_modules/next-xss-sbyd/dist/inventory.js . --markdown --json`.
It records `.md`/`.mdx` documents and candidate renderer, plugin, configuration,
HTML sink, and unknown-wrapper sites. Inventory is heuristic; MDX file contents
are not analyzed as executable code. Review unknown wrappers and unresolved
loaders before interpreting absence of findings. See [Markdown migration](../docs/markdown.md).

## Rules

| Rule | Default | Operation checked |
| --- | --- | --- |
| `require-safe-markdown` | opt-in | React Markdown renderer import boundaries |
| `no-unreviewed-mdx-execution` | opt-in | MDX compilation/execution import boundaries |
| `no-danger` | error | Raw JSX HTML insertion and `__html` objects |
| `no-unsafe-html-response` | error | `Response`/`NextResponse` constructors and unchecked returned responses, including typed fetch/helper calls, in route, middleware, proxy, and configured server files |
| `no-unsafe-api-send` | error | Raw text/bytes and safe HTML/stream values at ordinary `send`, `write`, and `end` calls on Pages/Node responses |
| `require-safe-api-route` | error | Pages API default exports require `withSafeApiRoute`, including composed wrappers |
| `require-safe-route-handler` | error | Every App Router HTTP export requires `withSafeRouteHandler` |
| `no-raw-render-to-string` | error | Direct React server-renderer imports |
| `safe-jsx-urls-active` | error | Active-resource URLs require `TrustedResourceUrl` |
| `safe-jsx-urls-navigation` | not in preset | Dangerous passive-URL literals, for standalone use |
| `require-safe-jsx-runtime` | error | Required JSX runtime configuration and direct factory/runtime bypasses |
| `no-html-content-type` | error | Non-passive, invalid or dynamic Content-Type selection; neutralization or removal of response security headers |
| `no-dynamic-script-style` | error | Dynamic inline script/style and bootstrap content |
| `no-unsafe-cast-to-safe-type` | error | Brand assertions and `any` passed to branded sink parameters |
| `require-disable-justification` | error | Unlimited or unexplained `xss-sbyd/*` disables |
| `no-html-template-strings` | error | Interpolated HTML-looking template strings |

See the [rule reference](rules.md) for each finding's cause, repair, options, and limitations.

Passive URL strings produce no lint diagnostic because `jsxImportSource` validation
checks the final merged props at runtime. Active-content strings remain errors. These
rules do not relax explicit raw-HTML attributes or `createElement`/`cloneElement`
calls. `no-danger` relaxes only JSX spread diagnostics when the TypeScript program
verifies `jsxImportSource: "next-xss-sbyd"`; the runtime then verifies `SafeHtml` objects in raw HTML attributes and validates
URL attributes on built-in elements, including attributes from spreads, regardless
of their static type. The standalone navigation rule can still
catch obviously dangerous literals, but the recommended preset relies on runtime
validation and does not require passive URL brands.

`no-unsafe-html-response` accepts a `customServerFiles` list of normalized path
suffixes for nonstandard server entry points. It assumes the application calls `installResponseGuard()` at startup. There is no
option to disable that requirement. No rule supplies
an autofix that chooses a sanitizer, URL policy, or response semantics on the
developer's behalf.

`require-safe-route-handler` accepts `export const GET = withSafeRouteHandler(handler)`
and same-module immutable aliases such as `const GET = withSafeRouteHandler(handler);
export {GET};`. Import the helper from `next-xss-sbyd/route-handler` for Node or Edge.
ESLint `--fix` wraps simple functions and constants. Rewrite destructured or
re-exported handlers explicitly; overloaded functions require manual migration.
The wrapper must be outermost so it checks the final response.

Return native upstream responses through `passiveResponse(await fetch(...))` from
`next-xss-sbyd/route-handler`; the Node-only `next-xss-sbyd/enforce` entry also
re-exports it. `installResponseGuard()` cannot validate native fetch results.
The response rule follows local const aliases, awaited expressions, conditional
branches, and arrow expression bodies. It recognizes the `PassiveResponse` return
type of `passiveResponse()`, including renamed and namespace imports, typed helper
returns, `Promise<PassiveResponse>`, and `let` variables. Annotating a checked helper
as `Response` erases the brand. Ordinary data fetches that are consumed rather than
returned are unaffected. It checks all response-returning
functions in the configured files conservatively; custom helpers that hide safe HTML
construction require review and a justified suppression. `any` types, exported handler
references without local bodies, arbitrary data passed through several functions,
and mutations after the check remain outside this analysis. See the main README for
the runtime checks and their limits.

`no-unsafe-api-send` rejects safe values at ordinary response methods even inside
`withSafeApiRoute`. Use `response.safeSend(html)` or `response.safeEnd(html, callback)`
for `SafeHtml`, `safePipe(response, stream)` for `SafeNodeStream`, and `SafeResponse`
for Web `SafeStream`. The rule can rename `send`/`end` when the argument is proven
`SafeHtml` and the receiver exposes the corresponding safe method. It leaves
optional calls, stream bodies, mixed body types, unsupported overloads, and
unwrapped response types for manual review. Explicit response annotations and
shared HTML helpers should use `SafeApiResponse` from `next-xss-sbyd/enforce`.

`no-html-content-type` rejects `Headers.delete` and Node `removeHeader` calls
that remove `Content-Type` or `X-Content-Type-Options`, including dynamic header
names that might select either header. A name whose type is a finite set of string
literals (a `const`, literal union, or string enum member) is accepted when none
is `Content-Type` or `X-Content-Type-Options`, compared case-insensitively.
Keep these headers on passive responses
to prevent HTML sniffing. The recommended preset uses receiver types to exclude
unrelated `Map`, `Set`, and `URLSearchParams` deletion. Receivers typed as `any`
are conservatively treated as potential headers. Type information is required.
The rule shares the runtime's [passive content policy](../docs/passive-content.md)
through `next-xss-sbyd/passive-content`. It rejects SVG, XML, and types not known to be passive, including after construction; `nosniff` does not prevent scripts
in correctly labeled SVG/XML documents. HTML retains its wrapper-specific diagnostic.
Legitimate active-document endpoints require a security-reviewed exception and
appropriate response construction; suppressing lint does not bypass runtime checks.
Absence from the policy does not establish that a format executes JavaScript.
Findings concern explicit header writes and constructor header objects in linted
source, not static assets or every framework-generated response. A rejected type
fails recommended lint and can block CI even for a legitimate endpoint. Calendar,
TIFF, and the listed HLS aliases work directly with the shared runtime policy.

For a reviewed exception, this complete route serves only a fixed, application-owned
stylesheet. No request, database, or upstream value contributes to its bytes:

```ts
// eslint-disable-next-line xss-sbyd/require-safe-route-handler -- Fixed application-owned CSS only; the wrapper rejects text/css.
export function GET() {
  const response = new Response("body { color: navy; }", {
    headers: {"Content-Type": "text/plain", "X-Content-Type-Options": "nosniff"},
  });
  // eslint-disable-next-line xss-sbyd/no-html-content-type -- Fixed application-owned CSS; no untrusted bytes or URLs.
  response.headers.set("Content-Type", "text/css");
  return response;
}
```

The guarded constructor accepts the initial plain text; the deliberate mutation
requires review because runtime construction checks do not recheck later headers.
The route also explicitly opts out of `withSafeRouteHandler`, which would reject
the final `text/css` response. Both scoped suppressions pass
`require-disable-justification`. Keep the wrapper on ordinary routes; this exception
is limited to these fixed application-owned bytes. This example does
not authorize arbitrary CSS or SVG/XML bodies: untrusted SVG/XML can execute script
on direct navigation despite `nosniff`. For unlisted downloads, use
`application/octet-stream` plus `Content-Disposition: attachment` instead.
The rule also rejects empty or malformed `Content-Type` values (including parameters) and
`X-Content-Type-Options` values other than a literal `nosniff` (case-insensitive)
in `set`, `append`, `setHeader`, and inspected header objects.
`installResponseGuard()` does not check headers changed after construction
or add `nosniff` to passive responses. `withSafeRouteHandler` validates
the final response and adds `nosniff`; the exception above explicitly omits it.
Indirect calls through `call`, `apply`, or bound methods need manual review,
as do custom header wrappers without the platform `getSetCookie` member.
Direct header-name type assertions are unwrapped, but assertions stored in aliases
(such as `const n = name as "X-Trace"; headers.delete(n)`) need manual review.
Computed methods with an unresolved name are conservatively treated as potential
deletions. A known literal method such as `get`, or a finite union of literal
methods containing neither `delete` nor `removeHeader`, is excluded. Direct type
assertions are unwrapped before resolving computed method names.

`require-safe-api-route` follows imported wrapper aliases, namespace imports, and
constant handler aliases. `withAuth(withSafeApiRoute(handler))`,
`withSafeApiRoute(withAuth(handler))`, and
`withAuth({roles: ["admin"]}, withSafeApiRoute(handler))` pass. Composing calls
can receive the wrapped handler in any non-spread argument. A same-named local
function does not satisfy the rule. Custom wrapper abstractions that hide the call in a function
body require review and a justified rule suppression.

`no-html-template-strings` uses a heuristic and can also match non-HTML syntax.
See [resolving HTML template string errors](../docs/retrofit.md#resolve-html-template-string-errors)
for JSX and sanitizer replacements, intentional test fixtures, and narrowly justified
false-positive exemptions.

The rule accepts `excludedTags` for reviewed template-tag functions:

```js
export default [
  ...xssSbyd.configs.recommended,
  {
    rules: {
      "xss-sbyd/no-html-template-strings": ["error", {excludedTags: ["reviewedHtml"]}],
    },
  },
];
```

This excludes only bare identifier tags with exactly the configured name, such as
`` reviewedHtml`<p>${value}</p>` ``; `` tags.reviewedHtml`<p>${value}</p>` `` still
reports. Matching is by name, so review every binding with that name before opting
in. The option skips this heuristic only; it does not sanitize HTML, produce
`SafeHtml`, or relax runtime checks on HTML objects.
