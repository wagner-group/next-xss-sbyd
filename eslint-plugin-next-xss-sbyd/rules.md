# ESLint rule reference

Use the [recommended configuration](README.md#configuration) with the validating
JSX runtime, which checks element props when JSX creates elements, and the installed
response guard, which checks Web `Response` construction and Node
`write`, `end`, and `writeHead` calls before output. Lint
checks source code; these runtime checks inspect the values used by the application.
All rules below are errors in
`recommended` except `safe-jsx-urls-navigation` and the two opt-in Markdown
rules, which are not in that preset.
`lintMigration` changes enabled rules to warnings except
`require-disable-justification`, which stays an error; it does not relax runtime
checks. See [configuration](README.md#configuration) for TypeScript project setup.

Rules have no options unless listed below. Repairs depend on whether the value is
text, HTML, a URL, code, or CSS. Most findings need a manual repair; the limited
`no-unsafe-api-send` and `require-safe-route-handler` autofixes are described in
their sections.

## no-danger

Reports explicit `dangerouslySetInnerHTML`, `__html` object properties, and raw
React factory calls whose props may contain HTML injection attributes. A JSX spread
is reported when its static type contains `dangerouslySetInnerHTML` or is
`any`/`unknown`, unless a later explicit attribute overrides that property or the
TypeScript program verifies the validating JSX runtime. A spread typed only as
`{className: string}` is not reported. The runtime checks the final merged props;
explicit raw HTML remains forbidden.

For text, use JSX children, such as `<p>{message}</p>`. For intentional HTML, construct
`SafeHtml` by safe rendering or the package sanitizer and pass it to `SafeBlock`:

```tsx
import {SafeBlock} from "next-xss-sbyd";
import {safeRenderToString} from "next-xss-sbyd/render";

const html = safeRenderToString(<p>{message}</p>);
const view = <SafeBlock html={html} />;
```

Do not wrap an arbitrary string in `{__html: value}`. See
[new HTML code](../docs/newcode.md) for the available safe constructors and sinks.

## no-unsafe-html-response

Checks `Response`/`NextResponse` construction and unchecked returned responses in
App Router `route` files, middleware, proxy files, and configured server files.
It reports raw HTML, bodies without a proven non-HTML type, and safe HTML/streams
passed to ordinary constructors. Native `fetch()` results require a return-time
check because they bypass the constructor guard. `passiveResponse()` returns
`PassiveResponse`; typed helpers, including `Promise<PassiveResponse>` returns,
retain this check. A plain `Response` annotation or `clone()` loses the brand.

```tsx
import {SafeResponse} from "next-xss-sbyd";
import {withSafeRouteHandler} from "next-xss-sbyd/route-handler";
import {safeRenderToString} from "next-xss-sbyd/render";

export const GET = withSafeRouteHandler(function GET() {
  return new SafeResponse(safeRenderToString(<p>Hello</p>));
});
```

Use `SafeNextResponse` when Next response features are needed. For passive upstream
data, return `passiveResponse(await fetch(url))` from `next-xss-sbyd/route-handler`
inside the wrapper. The Node-only `next-xss-sbyd/enforce` module re-exports both helpers.
For ordinary data, use an explicit runtime-allowed content type.

Options: `{customServerFiles: ["server.ts"]}` adds normalized filename suffixes.
The rule follows local constant aliases and conditional returns, not arbitrary
interprocedural flow or later header mutations. It assumes the response guard is
installed. A non-HTML MIME label is not by itself proof that a document is passive.
Use the runtime's allowed passive types and review the final response, including
changes made after construction by helpers or middleware.

## no-unsafe-api-send

Reports raw strings/bytes and safe HTML/stream values sent to ordinary
`send`, `end`, or `write` methods on receivers typed as `NextApiResponse`,
`ServerResponse`, or `Http2ServerResponse`, on a `Send<...>` function type, or on
receivers whose `statusCode` declaration comes from Node's HTTP/HTTP2 types. The rule
does not prove that an earlier header assignment makes a raw write safe.

Inside `withSafeApiRoute`, send `SafeHtml` through `response.safeSend(html)` or
`response.safeEnd(html, callback)`. Use `response.json(data)` for JSON,
`safePipe(response, stream)` for `SafeNodeStream`, and `SafeResponse` for a Web
`SafeStream`. Every raw string or byte write on these receivers is reported,
including non-JSON passive text output. Such a route needs a justified disable;
the final content type must still satisfy runtime enforcement:

```ts
import {withSafeApiRoute} from "next-xss-sbyd/enforce";

export default withSafeApiRoute((_request, response) => {
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  // eslint-disable-next-line xss-sbyd/no-unsafe-api-send -- Fixed plain-text response; the response guard validates its final headers
  response.send("ok");
});
```

The autofix only renames `send`/`end` for a proven `SafeHtml` argument when the
receiver exposes a compatible safe method. It does not fix `write`, optional calls,
streams, mixed types, or unsupported overloads. Explicitly typed handlers and
shared helpers should use `SafeApiResponse` from `next-xss-sbyd/enforce`.

## require-safe-api-route

Requires Pages API default exports to use the package's `withSafeApiRoute` wrapper.
This installs the safe HTML methods and guards ordinary output methods.

```ts
import {withSafeApiRoute} from "next-xss-sbyd/enforce";

export default withSafeApiRoute((_request, response) => {
  response.json({ok: true});
});
```

Imported aliases, namespace imports, constant handler aliases, and compositions
such as `withAuth(withSafeApiRoute(handler))` are recognized. A same-named local
function is insufficient. A custom abstraction hiding the wrapper in another
function body needs review and a specific justified suppression.

## require-safe-route-handler

Requires each exported App Router HTTP method (`GET`, `HEAD`, `POST`, `PUT`,
`DELETE`, `PATCH`, or `OPTIONS`) to use `withSafeRouteHandler`. The wrapper checks
the final response body and headers after the handler returns, including forwarded
responses and headers changed inside the handler. This also applies to JSON-only
routes. Other route configuration exports are unaffected.

```ts
import {withSafeRouteHandler} from "next-xss-sbyd/route-handler";

export const GET = withSafeRouteHandler(() => Response.json({ok: true}));
```

The import above works in Node and Edge; Node callers can also import the helper
from `next-xss-sbyd/enforce`. Renamed imports are recognized. `export {GET};` is
accepted when `GET` is a same-module `const` initialized by the imported wrapper.
A mutable binding, re-export, or unrelated same-named function does not satisfy
this rule. Keep this wrapper outermost so it checks the final response.

ESLint `--fix` wraps simple function declarations and initialized constants,
adding an import when needed. It leaves overloaded functions, destructuring,
re-exports, mutable declarations, and functions called before their declaration
for manual migration. For a third-party handler object, write
`export const GET = withSafeRouteHandler(handlers.GET)` and repeat for each HTTP
method. See [response validation](../README.md#configure-the-response-guard) for
safe HTML, streams, forwarding, and error labels.

## no-raw-render-to-string

Reports direct imports or re-exports of `renderToString`, `renderToStaticMarkup`,
`renderToPipeableStream`, and `renderToReadableStream`; namespace imports;
export-all declarations; and dynamic imports from `react-dom/server`,
`react-dom/server.browser`, `react-dom/server.bun`, `react-dom/server.edge`, and
`react-dom/server.node`. Raw renderer output lacks the package's safe output type,
whose value the package checks came from a safe producer before sending it.

Import from `next-xss-sbyd/render` instead: use `safeRenderToString` for string or
static-markup output, `safeRenderToPipeableStream` for Node streams, or
`safeRenderToReadableStream` for Web streams. Pass their results to `SafeBlock`,
the safe response constructors for `SafeHtml`/`SafeStream`, or `safePipe` for
`SafeNodeStream`. Check the
[renderer guide](../docs/newcode.md) when migrating stream lifecycle callbacks;
the wrappers are not a promise that every raw renderer option has identical semantics.

## safe-jsx-urls-active

Requires `TrustedResourceUrl` in these attributes:

- `src` on `script`, imported `next/script`, `iframe`, `frame`, and `embed`.
- `data` on `object`.
- `href` on `link` when `rel` is dynamic or is `stylesheet`, `preload`,
  `modulepreload`, or `import`. The current lint rule does not check a missing
  `rel` attribute.
- `href`, `xlink:href`, and `xlinkHref` on SVG `use`, `image`, and `feImage`.

`srcDoc` on `iframe` and `frame` requires `SafeHtml`. The rule also rejects
`base href` and literal meta refresh. Known dangerous URL literals remain invalid
even in attributes that accept trusted URLs.

```ts
import {trustedResourceUrl} from "next-xss-sbyd";

const scriptUrl = trustedResourceUrl`/assets/application.js`;
```

This constructs a trusted value for APIs that accept `TrustedResourceUrl`.
React's native `script.src` type accepts a string, so the constructed object cannot
be passed directly to that prop. Do not cast it to a string to bypass the mismatch.

Select developer-controlled resources; do not cast an attacker-controlled URL into
a trusted type. Review embedded content; use `SafeExternalIframe` with a `TrustedResourceUrl` and an
explicit sandbox of `""` or `"allow-scripts"`. See [URL guidance](../docs/newcode.md#urls-automatic-validation-for-passive-sinks)
for the distinction between ordinary navigation and active content.

## safe-jsx-urls-navigation

This optional rule reports obvious `javascript:`, `vbscript:`, and `data:` literals
in `a.href`, `area.href`, `audio.src`, `button.formAction`, `form.action`,
`img.src`/`srcSet`, `input.src`/`formAction`, `source.src`/`srcSet`, `track.src`,
`video.src`/`poster`, imported `next/form.action`, `next/image.src`/`srcSet`, and
`next/link.href`/`as`. It is not enabled by the recommended preset, which relies on the
validating JSX runtime to inspect the final merged props.

Replace dangerous literals with root-relative or HTTP(S) destinations;
for example, `<a href="/account">Account</a>`. Use a button with an event handler
for an action rather than a JavaScript URL. Forms must also meet the runtime's
same-origin policy. A URL check validates the address, not the fetched content.
This literal check cannot establish that a dynamic URL is safe
and does not replace runtime validation.

## require-safe-jsx-runtime

Reports missing `jsxImportSource`, JSX override pragmas, direct React JSX-runtime
imports, and tracked `React.createElement`/`cloneElement` calls that bypass validation.

Set this option in the TypeScript configuration actually used by the application:

```json
{"compilerOptions": {"jsxImportSource": "next-xss-sbyd"}}
```

Remove local `@jsx`, `@jsxRuntime`, and `@jsxImportSource` pragmas. Prefer JSX over
raw element factories; where a factory is needed, import the validating
`createElement` from `next-xss-sbyd`. Keep the application's existing JSX mode and
other compiler settings. See [configuration](README.md#configuration).

## no-html-content-type

Reports manual HTML content types, types outside the shared passive policy,
dynamically computed values, malformed MIME essences or parameters, and attempts
to remove or weaken `Content-Type` or
`X-Content-Type-Options`. Dynamic header deletion is rejected when it could remove
either security header. A name whose type is a finite set of string literals
(a `const`, literal union, or string enum member) is accepted when none is
`Content-Type` or `X-Content-Type-Options`, compared case-insensitively.
Typed unrelated collections are excluded from that check.
A MIME *essence* excludes parameters: in `text/plain; charset=utf-8`, it is
`text/plain`.

The rule uses the runtime's [shared passive policy](../docs/passive-content.md)
through its required `next-xss-sbyd` peer dependency. SVG and XML can execute
JavaScript during browser navigation despite `nosniff`; explicit writes of those
types are rejected, including mutations after construction. An unlisted type is
reported as not known to be passive, rather than as proven to execute JavaScript.
Malformed headers are diagnosed before HTML-specific handling. These findings
inspect source header writes, not static assets or every generated response.

For a legitimate exception, see the [tested fixed-CSS route](README.md#rules).
Its scoped suppressions justify both the header mutation and the omission of
`withSafeRouteHandler`, which rejects the final CSS type. The response is
constructed under the installed constructor guard. Suppression does not bypass runtime
checks; unlisted downloads can instead use `application/octet-stream` with
`Content-Disposition: attachment`. Never apply that fixed-content exception to
attacker-controlled SVG or XML.

Let `SafeResponse`, `SafeNextResponse`, or the safe Node methods set the HTML
headers after checking that the body came from a safe builder, renderer,
sanitizer, or reviewed conversion. For data output, choose a fixed
runtime-allowed type, retain it, and use the literal `nosniff`:

```ts
const headers = {
  "Content-Type": "text/plain; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};
```

The rule checks `headers` object literals in constructor options, header objects
in `writeHead`, and `setHeader`, `set`, `append`, `removeHeader`, and `delete`
calls. It does not inspect a standalone `new Headers({...})` initializer. Indirect calls, custom wrappers, and
changes made after the checked operation need review. Use runtime-allowed passive
types; absence of a finding does not establish that the final response is passive.

## no-dynamic-script-style

Reports dynamic inline script/style expressions, spreads that may supply unsafe
`children` or `dangerouslySetInnerHTML`, raw HTML attributes, and nonliteral
`bootstrapScriptContent`. It also checks imported `next/script` components. `bootstrapScriptContent` is a renderer option for
inline JavaScript that initializes the rendered page.

For data consumed by JavaScript, use `<SafeJsonScript id="state" data={state} />`
and `readJsonScript`. Keep executable code in a static bundle. When inline code or
CSS is necessary, use `SafeScriptBlock` with `safeScript`, or `SafeStyleBlock` with
`safeStyleSheet`, constructed from reviewed literal-only templates. Supply the
application's authenticated CSP nonce when required. Escaping HTML does not make
dynamic JavaScript or CSS safe. In an inline script, the HTML parser can interpret
`</script>` as the end of the element even when it appears inside a JavaScript
string. The safe JSON component handles this embedding problem; ordinary JSON
serialization alone is insufficient.

## no-unsafe-cast-to-safe-type

Reports assertions that fabricate package safe types and detected `any` flows into
safe parameters, variables, returns, properties, or the imported component props
`SafeBlock.html`, `SafeScriptBlock.script`, and `SafeStyleBlock.css`.
These types use a brand to distinguish their values from ordinary strings during
TypeScript checking. A cast does not construct the value or satisfy runtime checks.
A cast from a union is reported unless every alternative already carries the
brand, including nullish alternatives: `SafeHtml | string` and `SafeHtml | null`
cannot be asserted into `SafeHtml`. Narrow the value first. A non-null assertion
such as `maybeHtml!` remains allowed because it only removes nullish alternatives.
Optional brand properties also do not establish the required brand, including
`Partial<SafeStream>` and `Partial<SafeNodeStream>`.

Replace `input as SafeHtml` with a constructor for the intended output: `htmlEscape(input)` for
plain text, safe rendering for JSX, or the package sanitizer for untrusted HTML.
Use the matching URL, script, stylesheet, stream, or nonce constructor for other
brands; use `passiveResponse()` for `PassiveResponse`. Give untrusted input a
meaningful type and validate it; casting through `unknown` or `any` is not a repair.
Restricted conversions require a separate, documented review of the producer and
every place that consumes its output.

## require-disable-justification

Rejects unlimited `eslint-disable` directives and `xss-sbyd/*` disables without a
nonempty explanation after ` -- `. Name the specific rule and prefer the smallest
scope. Explain the actual reason the operation is safe, not merely why the finding
is inconvenient.

```ts
// eslint-disable-next-line xss-sbyd/no-html-template-strings -- CLI help is written only to the terminal, never rendered as HTML
const usage = `Usage: ${command} <file>`;
```

The rule checks that an explanation exists; it cannot validate the reasoning.
Suppression does not change runtime checks. This rule remains an error in
`lintMigration`.

## no-html-template-strings

Reports interpolated template literals whose static pieces look like HTML, including
tags, comments, and doctypes. This heuristic can also match CLI help or intentional
test fixtures. Static templates and plain interpolated text do not trigger it;
that does not authenticate their output as HTML.

Build JSX such as `<p>{name}</p>`. Use `safeRenderToString` when `SafeHtml` is
needed, or the sanitizer for existing untrusted HTML. For intentional fixtures or
non-HTML matches, use a reviewed line-level disable with a reason. Place it before
the opening backtick for multiline templates. See
[resolving HTML template string errors](../docs/retrofit.md#resolve-html-template-string-errors)
for migration examples and false positives.

Options: `{excludedTags: ["reviewedHtml"]}` exempts only a bare identifier tag
with the exact configured name. Member tags such as `tags.reviewedHtml` are not
exempt. Matching is by name, so review every binding before adding an exclusion.
This option only skips the heuristic; it does not produce `SafeHtml` or relax any sink.

## require-safe-markdown

Opt-in: `configs.markdown` enables errors; `configs.markdownMigration` enables
warnings. Add one after the corresponding base preset. Reports direct value
imports/re-exports of `react-markdown` and `markdown-to-jsx`, including subpaths.
Use `SafeMarkdown` from `next-xss-sbyd/markdown` for ordinary content, or review a
narrow adapter when a different rendering policy is necessary. A default
`react-markdown` integration may already be safe; this rule enforces the project's
chosen rendering boundary, rather than claiming every direct import is vulnerable.

Aliases, namespace imports, named re-exports, export-all, CommonJS `require`,
TypeScript import-equals, and literal dynamic imports are checked at the module
boundary. Type-only imports are excluded. A locally defined `require` is not
mistaken for the CommonJS loader. Import findings remain even if a caller later
shadows the imported renderer; the import itself crosses the boundary. Nonliteral
`import()` and unshadowed `require()` report a coverage limitation. Arbitrary
wrapper implementations and indirect loader aliases need manual review.

HTML parsers such as `marked`, `markdown-it`, and unified remain allowed. Finish
all HTML transformations before `sanitizeUserHtml`, then pass its `SafeHtml` to
`SafeBlock`. Existing HTML sink and unsafe-cast rules still apply. There is no
autofix that removes plugins, changes options, or changes rendering semantics.

Preserve reviewed adapters in a specific file, with scoped justified disables
that identify the owner and relevant tests. `check-config` rejects disabled
optional rules when Markdown enforcement is selected; scoped inline exceptions
remain visible in `audit`. See the [Markdown guide](../docs/markdown.md) for
migration and compatibility limits.

## no-unreviewed-mdx-execution

Enabled by the same opt-in Markdown presets. Reports `createProcessor`, `compile`, `compileSync`,
`evaluate`, `evaluateSync`, `run`, and `runSync` imports from `@mdx-js/mdx`, plus
namespace/default loads, internal subpaths, `@next/mdx`, and `next-mdx-remote`
entry points. The import forms and dynamic-loading limitations described above
apply. These APIs compile or execute application code; an authenticated CMS,
literal source string, or same-origin fetch alone does not establish code trust.

Keep MDX integration in a narrowly reviewed file with an owner, justification,
source-authorization policy, and execution tests. Use ordinary Markdown for
untrusted content. Sanitizing rendered HTML cannot undo JavaScript execution on
the server, and CSP must not be relaxed automatically to enable evaluation.

The Markdown inventory discovers `.md` and `.mdx` files separately from JS/TS
lint coverage. Finding a document does not analyze its executable contents or
establish that every consumer has been found.
