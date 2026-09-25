# next-xss-sbyd

`next-xss-sbyd` is a Next.js extension intended to eliminate server-side XSS.
It provides types that record when data has been escaped, sanitized, or validated
for safe use. Its HTML APIs require these safe values, and its JSX runtime
checks HTML attributes to prevent XSS. ESLint rules prohibit unsafe APIs and coding
practices. CSP provides an additional layer of protection.

For adoption guidance, see [building a new application](docs/newcode.md) or
[retrofitting an existing application](docs/retrofit.md). The
[design document](docs/design.md) describes the approach, and
[caveats and residual risks](docs/caveats.md) identifies its limits.
`next-xss-sbyd` requires that the application be written in
TypeScript with type information.

Use the latest patch release of Node.js 22 (22.22.2 or later), 24 (24.15.0 or later), or 26.
Node.js 24 is the recommended LTS release; Node.js 26 is also supported.
Upgrade Node.js before migrating to this module if you use Node.js 20 or 21,
which are no longer supported. Other end-of-life Node.js releases are unsupported
as well. CI tests the runtime, ESLint plugin, and Next.js 14–16 compatibility on
Node.js 22, 24, and 26.


## ESLint plugin

The ESLint rules ban usage of existing APIs that bring
risk of XSS.  Enable them with:

```js
import xssSbyd from "eslint-plugin-next-xss-sbyd";

export default [...xssSbyd.configs.recommended];
```

The rules ban unsafe HTML insertion, response writing, and rendering calls. They
also report unsanitized URLs and dynamic content inside script or style blocks.
Use `next-xss-sbyd`'s safer alternatives. See
[`eslint-plugin-next-xss-sbyd/README.md`](eslint-plugin-next-xss-sbyd/README.md)
for rule and configuration details.

## Runtime core

To display untrusted HTML, pass it through `sanitizeUserHtml()` from
`next-xss-sbyd/sanitize`. It returns a `SafeHtml` object that records that the HTML
has been sanitized. Use `SafeBlock` to display that object or `SafeResponse` to send
it in an HTTP response. Both verify the object's identity at runtime, so a
TypeScript cast cannot substitute for sanitization.

The `next-xss-sbyd` extension provides:

- Explicit `SafeResponse` and `SafeNextResponse` constructors for checked HTML,
  plus `response.safeSend()` and `response.safeEnd()` installed by
  `withSafeApiRoute()` for Pages Router and custom Node handlers. `installResponseGuard()`
  replaces Node's global `Response` constructor to reject unchecked HTML strings.
- A validating JSX runtime that checks HTML attributes on built-in elements after
  merging JSX spreads (`{...props}`). It verifies `SafeHtml` objects for raw HTML,
  validates passive URLs, and verifies `TrustedScriptUrl` objects for active
  resources. This package also validates Next.js component URLs through `next-xss-sbyd/compat/link`,
  `next-xss-sbyd/compat/image`, and `next-xss-sbyd/compat/form`.
- `htmlEscape()` for escaping input so its markup displays as text.
- `navigationUrl()`, `resourceUrl()`, and `formActionUrl()` to sanitize
  URLs, so they cannot be used as a XSS vector, with matching `OrNull` variants for
  optional values that should disappear when invalid.
- `SafeBlock`, `SafeJsonScript`, `SafeJsonLdScript`, `SafeScriptBlock`,
  and `SafeStyleBlock` elements. These are safer replacements for
  script and style blocks (which can introduce XSS risk if dynamic
  content is included).

Configure `"jsxImportSource": "next-xss-sbyd"` in `tsconfig.json` and redirect
`next/link`, `next/image`, and `next/form` to the corresponding
`next-xss-sbyd/compat/*` exports in both Turbopack and webpack. See the new-code and
retrofit guides for complete configuration. Passive URL props on built-in elements
and these Next.js components may then remain ordinary strings: the runtime validates them and always throws on invalid input. Active-content
sinks still require a `TrustedScriptUrl` object created by this package. Raw
`dangerously*` and `srcDoc` props on built-in elements require a `SafeHtml` object
created by this package, including through spreads.


## Renderers

You can safely render JSX to HTML on the server side using
`safeRenderToString()`, `safeRenderToReadableStream()`, and
`safeRenderToPipeableStream()` from `next-xss-sbyd/render`.

## CSP middleware or proxy

To enable CSP, use `createXssSbydHandler()` or wrap existing middleware with
`withXssSbydHeaders()` from `next-xss-sbyd/csp`. Both enforce CSP by default. Use
`getNonce()` from the same module for inline script and style elements.
Next 14/15 applications export the handler from `middleware.ts`;
Next 16 applications export it from `proxy.ts`. See the docs for
details.

The policy allows ordinary style attributes with `style-src-attr 'unsafe-inline'`.
Inline `<style>` elements require the matching document nonce in browsers supporting
`style-src-elem`; older browsers allow inline stylesheets through the legacy fallback.
Script restrictions remain unchanged. See the [style policy guide](docs/csp-styles.md).

The [CSP rollout guide](docs/csp-rollout.md) covers violation collection, conservative
policy suggestions, application-specific policy profiles, and deployment verification.

For formatted HTML, use the synchronous `sanitizeUserHtml(dirty)` from
`next-xss-sbyd/sanitize` in browsers or Node, then display its `SafeHtml` through
`SafeBlock`. One fixed policy preserves formatting, images with validated URLs, native audio/video,
and visible `<mark>` wrappers. There is no policy argument. Sanitized content can load
resources; configure CSP image/media destinations for your application. Edge and workers
without a DOM are unsupported. See the [API and highlight recipes](docs/sanitize.md)
and [migration release notes](docs/releases.md).

<a id="configure-the-response-guard"></a>

## Check HTTP response bodies

Every application must complete both steps to enable response validation:

1. Add the following `instrumentation.ts` file at the application root, or in `src/`
   if the application uses `src/`.
2. Set `NODE_OPTIONS="--import next-xss-sbyd/enforce/preload"` in the build and server
   environments, as shown below.

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    (await import("next-xss-sbyd/enforce")).installResponseGuard();
  }
}
```

On Next.js 14, also set `experimental: {instrumentationHook: true}` in Next configuration.

Set the build and production start scripts in `package.json`:

```json
{
  "scripts": {
    "build": "NODE_OPTIONS='--import next-xss-sbyd/enforce/preload' next build",
    "start": "NODE_OPTIONS='--import next-xss-sbyd/enforce/preload' next start"
  }
}
```

These scripts use POSIX shell syntax. Preserve any existing build or start arguments.
`next build` prerenders static pages and route handlers into files served later, so
response validation must also run during the build.

This setting makes Node load the response validation code before Next.js during both
builds and server startup. Keep any existing `NODE_OPTIONS` flags alongside this
`--import` option. See [why startup order matters](docs/retrofit.md#set-node_options-for-builds-and-server-startup).

See the [hosting setup instructions](docs/retrofit.md#managed-hosting-without-a-controllable-node-startup-command)
if your provider manages the build or server commands.

Run `next-xss-sbyd-check-guard .` in CI to check the instrumentation file and the
`package.json` production start script. It passes when either is configured, even
if the startup option is missing. See [deployment verification](docs/retrofit.md#verify-the-deployed-behavior)
for the additional checks.

`installResponseGuard()` runs in Node.js and rejects unsafe string responses
at construction. Non-string `Response` bodies retain native behavior. Wrap each
App Router HTTP export with `withSafeRouteHandler()` to check its final response:

```ts
import {withSafeRouteHandler} from "next-xss-sbyd/route-handler";
import {htmlEscape, SafeResponse} from "next-xss-sbyd";

export const GET = withSafeRouteHandler(async function GET() {
  return new SafeResponse(htmlEscape("<safe text>"));
}, "app/api/example/route.ts GET");
```

`withSafeRouteHandler` and `passiveResponse` are available from the Node-free
`next-xss-sbyd/route-handler` subpath in both Node and Edge. The Node-only
`next-xss-sbyd/enforce` module re-exports both helpers. `withSafeRouteHandler` preserves
the receiver (`this`) and arguments supplied by its caller. It checks the effective headers after
the handler resolves, including Blob-inferred types, header mutations and forwarded
`fetch()` responses. Non-Response results throw. Null bodies pass with `nosniff`;
authenticated HTML streams require the fixed HTML headers; every other body requires
a passive type. It returns a fresh response with the same stream, status, status text
and copied headers, and forces `nosniff`. The copied headers remain mutable because
Next's Edge adapter removes internal headers after the handler returns. Mutating the
original headers cannot change the snapshot; changes to the returned snapshot or
downstream transformations occur after this check. It does not buffer the body. Supply the
optional second argument to identify the route in runtime errors, including consumed
or locked bodies. `Response.error()` has no body and passes through unchanged.
A passing null-body or HEAD response does not establish the safety of a GET body.

The `require-safe-route-handler` recommended lint rule requires each exported HTTP
method to be a `const` initialized by the imported wrapper; same-module
`const GET = withSafeRouteHandler(handler); export {GET};` is also accepted. Run ESLint with
`--fix` to migrate function declarations and ordinary initialized constants. Rewrite
re-exports and destructuring explicitly, for example
`export const GET = withSafeRouteHandler(handlers.GET)`. Keep this wrapper outermost.

All response checks use one strict MIME parser and the same passive allowlist as
the [documented policy](docs/passive-content.md), including `application/*+json`. It includes plain text,
JSON, SSE, both NDJSON aliases, CSV, TSV, Markdown and VTT; octet-stream; URL-encoded
and multipart form data; WebAssembly; explicitly listed raster images, audio,
video, fonts, archives and Office documents. Parameters must be syntactically valid.
The [passive content reference](docs/passive-content.md) lists every accepted type;
there are no image, audio, video, font or archive-family wildcards. This policy
also applies to `withSafeApiRoute`, `passiveResponse`, and the constructor's string
check. Unknown types, HTML, XML, SVG, JavaScript, CSS, PDF and multipart types other
than `multipart/form-data` are rejected. For unsupported downloads use
`application/octet-stream` plus `Content-Disposition: attachment`.

Here, passive means data, media or downloads during browser navigation. It does not
validate file bytes or make downloads safe to open in external applications.
Markdown still needs sanitization when converted to HTML; form-data file parts
are not approved for document rendering. [WebAssembly requires explicit compilation
and instantiation](https://webassembly.github.io/spec/web-api/index.html#streaming-modules);
this policy does not authorize executing untrusted modules. Office macros,
spreadsheet formulas and native-preview vulnerabilities are outside this policy.
Keep the checked `Content-Type` and `X-Content-Type-Options: nosniff` on responses.
The route wrapper and `passiveResponse` force `nosniff`; the constructor guard and
ordinary Node wrapper do not add it for passive bodies. [Fetch's nosniff rules](https://fetch.spec.whatwg.org/#should-response-to-request-be-blocked-due-to-nosniff)
are also needed to block mislabeled classic scripts.

Run `npm run build`, `node --test tests/issue-224.test.mjs`, and
`node scripts/test-passive-content-browser.mjs` to verify the policy over real HTTP
and navigation in Chromium, Firefox and WebKit. The browser checks cover every
listed type with executable HTML, plus a form-data body containing an HTML file,
through the Node wrapper, proxy and App Router wrapper.

Safe response clones retain authenticated stream identity, including both branches
created by native cloning. The first safe response installs an idempotent
`Response.prototype.clone` patch to track both branches; importing the package alone
does not change that prototype. Rewrapping the same safe stream with copied headers also
works. Reading safe HTML into text/bytes or transforming the stream loses that
identity; authenticate the resulting HTML again before serving it. Next's cookie
merge and prerender buffering happen after the handler check and need no exemption.
Middleware/proxy responses still use existing enforcement; adding the same final
check there is a separate change.

`withSafeApiRoute()` enforces the shared passive allowlist for nonempty byte writes
in Pages Router and custom Node handlers, including ordinary stream piping.
Next's `send(Buffer)` still infers `application/octet-stream` when no type is set.

Set an allowed content type before piping an ordinary stream. A rejected chunk in
`Readable.pipe(response)` can escape Next's handler error boundary and close the
connection instead of producing an HTTP error response; a rejection after headers
were sent can truncate a success response. Observe stream and socket errors in the
server's error handling rather than relying on a surrounding synchronous `try/catch`.

Standard `send()`, `end()`, and `write()` reject `SafeHtml`, `SafeStream`, and
`SafeNodeStream`; send HTML through the safe methods and Node streams through `safePipe()`.
If a client disconnects before rendering finishes, `safePipe()` aborts rendering and
reports React's "The destination stream closed early." error to `options.onError`,
for both ordinary and guarded responses.

```ts
import {htmlEscape} from "next-xss-sbyd";
import {withSafeApiRoute} from "next-xss-sbyd/enforce";

export default withSafeApiRoute((_request, response) => {
  response.status(200).safeSend(htmlEscape("<safe text>"));
});
```

Use `SafeApiResponse` for explicitly typed HTML handlers and shared helpers. It preserves
Next's fluent methods and JSON types. `safeSend()` returns `void` with Next's normal send
processing; `safeEnd(html, callback?)` returns the response with native Node end semantics.
There is no standalone `safeSend` export, and unwrapped responses have no safe methods.
The `require-safe-api-route` lint rule requires the wrapper on Pages API default exports,
including when composed with other handler wrappers.

`installResponseGuard()` checks responses at construction; `withSafeRouteHandler()`
checks headers after the handler resolves. Frameworks and proxies can still change
headers after that check. Keep the recommended ESLint rules enabled so every HTTP
export is wrapped. The rules always assume `installResponseGuard()` runs at startup;
there is no setting to disable this requirement.

Native `fetch()` responses bypass the constructor guard. The route wrapper rejects
forwarded active content; `passiveResponse` additionally filters upstream headers
for passive proxy responses:

```ts
import {passiveResponse, withSafeRouteHandler} from "next-xss-sbyd/route-handler";

export const GET = withSafeRouteHandler(async function GET() {
  return passiveResponse(await fetch("https://files.example.com/public/data.json"));
});
```

`passiveResponse` uses the same [passive content allowlist](docs/passive-content.md)
and strict parameter syntax. It rejects HTML, XML, SVG, JavaScript, PDF, missing,
malformed, and unlisted types, including on empty responses. All 3xx statuses, including 304, are rejected; handle redirects and cache
revalidation explicitly in application code. The helper forwards only `Content-Type`,
`Content-Disposition`, `Cache-Control`, `ETag`, `Last-Modified`, `Vary`, `Expires`,
`Content-Language`, `Accept-Ranges`, and `Content-Range`, then forces
`X-Content-Type-Options: nosniff`. Upstream cookies, CORS, navigation, security-policy,
hop-by-hop headers, and status text are discarded. It preserves the status and decoded
body stream without buffering. `Content-Length` is preserved only without
`Content-Encoding`; encoded responses lose both headers because native fetch decodes
them. Use this helper with native fetch output, not manually encoded response bodies. Do not read the original body after passing it to the helper.

For intended HTML, escape or sanitize the upstream text into `SafeHtml`,
then use `SafeResponse` or `SafeNextResponse`. Passing an upstream response to
`passiveResponse` rejects HTML responses. Fetching HTML as data alone does not
execute it. This helper does not validate upstream URLs or provide an SSRF policy.

The existing `no-unsafe-html-response` rule continues to check response constructors
and unchecked returns in middleware, proxy and configured server files. It follows
local handler and response constants. `passiveResponse` returns the opaque
`PassiveResponse` type, exported from both `next-xss-sbyd/route-handler` and
`next-xss-sbyd/enforce`. Keep this type (or let TypeScript infer it) on checked
response helpers, including `Promise<PassiveResponse>` for async helpers; lint also
recognizes checked `let` variables. Annotating a helper as plain `Response` erases
this information. Cloning returns a plain `Response`; check the clone again with
`passiveResponse`. Casts and `any` assignments that forge the brand are lint errors.
Bare declarations and lookalikes built from mapped types can preserve brand
properties and are outside the lint rule's forgery detection.
The brand records the helper's check, not immutable headers: changing headers
requires revalidation, and `withSafeRouteHandler` still checks every response where installed.
Keep `SafeResponse`/`SafeNextResponse` return types on HTML helpers. In App Router files,
`require-safe-route-handler` requires the final runtime wrapper; helpers may return
plain `Response` because that wrapper validates their effective body and headers.

When migrating an application, run `next-xss-sbyd-inventory .` to list statically visible
`Response`, `NextResponse`, their safe constructors, `safeSend`/`safeEnd` methods, and
`safePipe` calls, with statically visible content types.
Review the reported calls when migrating response handlers.

Use `next-xss-sbyd/restricted` when a human security expert has determined that
data is XSS-safe, but this package's built-in APIs cannot recognize its safety. For
example, the expert may have reviewed an application-specific sanitizer. Restricted
APIs mark the data as reviewed and create a safe value accepted by the runtime.
They do not sanitize the data themselves.

`TrustedScriptUrl` and its template builder `trustedScriptUrl` mark URLs whose
JavaScript is trusted to execute. They use the existing SafeValues runtime brand.
Active iframe and other resource sinks continue to require this same trust.

## Duplicate SafeValues installations

Construct SafeValues through builders exported by `next-xss-sbyd`.
Don't import `safevalues` yourself. SafeValues brands are tied to
the physical package copy that created them. Don't install/import
a second copy of `safevalues` and use it to create objects; if an
API/sink receives a value from a second installation, `next-xss-sbyd`
cannot verify its package identity and will reject it.


## Browser compatibility testing

`npm run test:compat` requires full Chrome/Chromium with native PDF support, not
headless shell. Set `CHROME_PATH` when Chrome is outside the standard locations.
After `npm run build`, run `node scripts/test-native-pdf.mjs` for the standalone PDF
check; it uses a local HTTP server and does not build or exercise Next.js.
