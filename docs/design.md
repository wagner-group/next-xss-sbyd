# Design of next-xss-sbyd

## Overview

`next-xss-sbyd` is a Next.js extension for TypeScript applications. It is intended
to eliminate server-side XSS. It replaces APIs that can introduce XSS with APIs that
require data to be sanitized before use. Safe types record which data has been
sanitized. ESLint rules reject usage of unsafe APIs. A strict CSP provides an
independent browser defense.

A **sink** is an operation that interprets data as HTML, code, or a URL, such as
inserting raw HTML or setting a script's source URL. This package's design requires
all server-side sinks to check that their input has been properly sanitized for
its use.

React already escapes ordinary JSX text and attributes. This package defines a
validating JSX runtime that modifies the standard implementation of JSX to check
HTML attributes as needed to prevent XSS. It also installs response APIs that require
safe HTML before sending it to the browser.

The design is inspired by Trusted Types, which lets applications require sanitization
before passing data to dangerous browser sinks such as `innerHTML`, and Google's
`safevalues` library, which provides safe types and functions to create them.
This package applies the same approach to server-side XSS in Next.js applications.

The runtime package is `next-xss-sbyd`; ESLint rules are in
`eslint-plugin-next-xss-sbyd`. We support TypeScript applications using Next.js 14–16
and React 18–19.

## Goals

- Turn inadvertent server-side XSS into TypeScript or ESLint errors.
- Keep ordinary JSX frictionless.
- Provide a safe path for contexts where React/JSX don't prevent XSS
  (HTML, URL, script, style, rendering, and response).
- Provide a way to implement custom, application-specific sanitizers,
  and make it easy to find and audit these bypasses.
- Support App Router, Pages Router, Route Handlers, custom Node/Web rendering, and
  middleware/proxy composition.
- Reject values that lack the safe type required by the API.
- Use ordinary TypeScript and ESLint rather than a custom compiler.

## Non-goals

- Preventing DOM-based client-side XSS.
- Protecting JavaScript applications without TypeScript.
- Defending against a malicious developer who deliberately subverts types, lint, and
  review.
- Whole-program analysis of reflection, arbitrary wrappers, generated code, or values
  hidden behind `any`.
- Proving third-party React components safe.
- A new HTML template language with context-dependent auto-escaping.
- Sanitizing HTML in the Edge runtime.

## Threat model

The attacker controls data that reaches server output: request parameters, stored
profile fields, CMS HTML, database values, imported feeds, or similar input. The
developer is trusted but may accidentally place that data into a browser execution or
markup context.

React already makes ordinary interpolation safe:

```tsx
<p>{attackerControlledText}</p>
```

However React's protections are imperfect, and there are a
number of cases that require extra developer attention.
The important risks are:

- `dangerouslySetInnerHTML`;
- dynamic URLs in JSX;
- HTML built using string interpolation;
- hand-built HTML in Fetch, Next, Pages Router, or Node responses;
- dynamic inline script and style bodies, including hydration data;
- direct React server rendering followed by string or chunk manipulation; and
- content-type confusion when bytes are sniffed as HTML.

Defending against XSS requires that context-appropriate
sanitization or escaping be added to each of these places.

Without the necessary sanitization, the application may appear to work while
containing XSS vulnerabilities. This package is intended to turn these mistakes
into type errors, build failures, or ESLint errors.

We assume the application is built with TypeScript and
the recommended xss-sbyd lint rules all pass. We assume
that escape hatches and restricted imports receive manual
review. We assume an attacker cannot edit application
source code or configuration.

Residual risks are [documented separately](caveats.md).
CSP mitigates several of these but is not a substitute for
safe code.

## High-level approach

```text
untrusted string
      |
      | validate / encode / sanitize / React-render
      v
safe value
      |
      | sink checks that value is marked as safe
      v
HTML response
```

After sanitization, the result carries a **brand** that records which uses are safe.
For example, `sanitizeUserHtml()` returns `SafeHtml`, and `navigationUrl()` returns
`SafeNavigationUrl`. Requiring these types prevents accidentally passing an unchecked
string to an API that can introduce XSS.

There are two implementations. `SafeHtml` and the other SafeValues types are objects
with runtime checks. Casting a string or copying object fields cannot create an
accepted object. `SafeNavigationUrl`, `SafeResourceUrl`, and `SafeFormActionUrl` are
strings with distinct TypeScript types. Those types exist only during type checking,
so the JSX runtime validates the actual URL string as well.

This design prevents accidental misuse of sanitizers and accidental use of a sanitized
value in a context it wasn't intended for. A navigation URL is not automatically safe
as a script source or form target.
We preserve the
standard `Response`, `NextResponse`, and Pages Router interfaces while checking
the type and brand of values flowing to them. ESLint rejects calls that bypass these
checks or pass values that are unsafe for the sink.

## Branded types and construction

### SafeValues types

This package uses Google SafeValues types to record which content is safe to use.
For HTML, the constructors escape text, sanitize rich text, or render React output.
For literal scripts, stylesheets, and resource URLs, developers review the content
before marking it safe.

| Type | Meaning | Normal constructor |
| --- | --- | --- |
| `SafeHtml` | HTML safe to insert or emit | `htmlEscape`, `sanitizeUserHtml`, safe React renderer from JSX |
| `SafeScript` | compile-time constant inline JavaScript | `safeScript` |
| `SafeStyleSheet` | compile-time constant CSS | `safeStyleSheet` |
| `TrustedScriptUrl` | URL trusted to serve JavaScript that may execute in the application | `trustedScriptUrl` |

Reusing these types allows us to take advantage of the
careful vetting of the `safevalues` package.

### Sink-specific URL types

Dynamic URLs that are injected into HTML must be validated.
For example, if an attacker can specify the URL, they can
specify a `javascript:` URL, enabling XSS.  We provide validators
to ensure that a dynamic URL is safe. The validation strategy
depends on how the URL will be used, so we provide multiple
options:

| Type | Allowed destination | Representative sink | Normal constructor |
| --- | --- | --- | --- |
| `SafeNavigationUrl` | root-relative, HTTP(S), `mailto:`, `tel:` | anchor and `Link` | `navigationUrl` |
| `SafeResourceUrl` | root-relative or HTTP(S) passive resource | image/media `src` | `resourceUrl` |
| `SafeFormActionUrl` | same-origin root-relative target | form action | `formActionUrl` |
| `TrustedScriptUrl` | resource controlled by the developer | script, iframe | `trustedScriptUrl` |

`navigationUrl`, `resourceUrl`, and `formActionUrl` whitelist the
protocol (scheme). They reject controls, whitespace,
backslashes, credentials, references beginning with `//`, non-hierarchical schemes
such as `data:`, and schemes
outside their allowlist.
The `navigationUrlOrNull` and `resourceUrlOrNull` variants apply identical validation
and canonicalization but return `null`, rather than throwing, when an optional value is
invalid. They cover only `navigationUrl` and `resourceUrl`; functions that combine URL parts still throw.

We provide a way to construct dynamic URLs. String interpolation
is dangerous because it can introduce XSS or path traversal.
Instead, we provide helpers like `relativePath`, `pathSegment`,
`withQuery`, etc. to build up dynamic URLs.

Sinks (places that accept URLs) can be decomposed into passive
vs active sinks. An active sink is one where the URL refers to
some Javascript that will be executed, e.g., `<script src=...>`.
A passive sink is one that won't execute Javascript, e.g.,
`<img src=...>`, assuming the URL has been validated (e.g.,
is not a `javascript:...` style URL).

Branded types for passive URLs are string subtypes. The JSX runtime accepts
ordinary strings at passive sinks, applies the appropriate validator after JSX spreads
are merged, and throws if the URL is unsafe. The brands remain useful for early
validation and non-JSX APIs, but passive JSX props do not require them.

Active sinks use SafeValues objects. In particular,
`TrustedScriptUrl` is a SafeValues object, because it refers to
Javascript that will be executed (or content that can cause execution
of Javascript). Active content requires stronger validation, to
check that origin and path are literal developer-controlled data.

React's type system only accepts a string for the `src` attribute of an
iframe, so a web application cannot write JSX like `<iframe src=...>`
and pass a `TrustedScriptUrl` as the URL.
`SafeExternalIframe` provides a way to express this,
while complying with the TypeScript type system.
At runtime `SafeExternalIframe` verifies that the URL is a safe
`TrustedScriptUrl`, and requires that the iframe either choose
all sandbox restrictions (`sandbox=""`) or allow scripts without
same-origin privileges (`sandbox="allow-scripts"`).
In particular, it never permits `allow-scripts` together with
`allow-same-origin`, because a document that becomes same-origin could remove its own
sandbox.
Applications should use `SafeExternalIframe` for new iframe code. The name refers to
URL-loaded documents, including same-origin URLs; it does not enforce a different
origin. `SafeIframe`, `SafeIframeProps`, and `SafeIframeSandbox` remain deprecated
aliases for `SafeExternalIframe`, `SafeExternalIframeProps`, and
`SafeExternalIframeSandbox`.

### Safe streams

React can send a rendered page in pieces instead of building the entire page in memory
first.
`safeRenderToReadableStream()` renders a React element tree and returns a
`SafeStream` for `SafeResponse` or `SafeNextResponse`. This is an opaque wrapper:
application code cannot append or transform chunks through its API. React produces
the complete output, preserving its HTML context across chunks. The renderer does
not sanitize arbitrary strings or prove that third-party component code is safe.

## Creating SafeHtml

### JSX + server-side rendering

The application can use JSX to build up a tree of elements. Then, it
can call `safeRenderToString` to render it to a `SafeHtml` value. This is safe because multiple checks work together:

- React escapes ordinary text and attribute values.
- This package's JSX runtime rejects raw HTML in `dangerouslySetInnerHTML` on
  built-in HTML/SVG elements. It also validates their URL attributes to prevent XSS.
- ESLint blocks dynamic data inside script or style blocks.
- Active URLs that can introduce Javascript must be validated (must be a `TrustedScriptUrl` value).
- `SafeBlock` can be used to insert sanitized HTML into a tree. It uses runtime checks to ensure that only `SafeHtml` can be inserted.

We can't inspect third-party components, so third-party components
could still emit unsafe HTML.
CSP limits the damage from this risk but does not make the component safe.

`safeRenderToReadableStream` and `safeRenderToPipeableStream`
provide streamable versions of `safeRenderToString`.

### Escaped text

`htmlEscape(text)` converts characters with special meaning in HTML into harmless
text. For example, it converts `<` to `&lt;`. The result is `SafeHtml`, so it can be
passed to an API that expects safe HTML. Inside a React component, ordinary JSX such as
`<p>{text}</p>` is usually simpler because React performs this escaping automatically.

### Sanitized rich text

`sanitizeUserHtml(dirty: string): SafeHtml` from `next-xss-sbyd/sanitize`
synchronously cleans formatted HTML in browsers and Node. One fixed policy
preserves ordinary structure, tables, links, images, native audio/video, and `<mark>`.
There is no policy parameter, exported policy object, or configuration API.
`sanitize-node` remains an alias for the Node adapter with the same rules.

The adapters share private DOMPurify configuration and a cleaning pipeline. The browser
adapter creates a private instance lazily when called with DOM support; import does not
access `window`. Node first uses parse5 to reject temporary or final HTML element
depth above 512, then sanitizes with a private JSDOM window. The pre-pass and JSDOM
must resolve the same parse5; a dependency contract test checks this assumption. Conditional exports put `types` first,
`edge-light` before `browser`, and `default` last. Edge import succeeds but calls throw;
workers without a DOM also fail clearly. Non-string input, extra arguments, and engine
failures throw rather than returning uncleaned input. Browser consumers do not need
JSDOM or `isomorphic-dompurify` in their bundle.

After parsing, the pipeline enforces per-element attributes and parent constraints,
validates decoded URLs with the existing navigation/resource validators, and writes
fixed link/image/media attributes. Text labels retain punctuation and colons. Only the
finished HTML becomes a `SafeHtml` object. Application code receives no mutable DOM,
engine instance, hook, or cleaning callback. See the [exact policy](sanitize.md).

Sanitized HTML may still load images and media. The policy removes executable
content, styles, forms, SVG/MathML, templates, custom elements, IDs/names, all data
attributes, and ID-reference attributes. Resource privacy
is controlled by application CSP or a reviewed proxy, not selectable sanitizer policies.

A Next.js client component may execute first during Node server rendering and later in
the browser. The universal import supports both. Browser-fetched content should instead
share an initial loading state, with sanitization in the parent before display and
highlight effects. JSON/storage/worker transport does not preserve `SafeHtml`
object identity: receiving code sanitizes strings again. Node and browser parsers need
not serialize malformed HTML identically; test hydration for the application's inputs.

## Safe React components

`SafeBlock` inserts `SafeHtml` into a React page. It is the safe replacement for
`dangerouslySetInnerHTML` and supports a fixed list of container elements that do not
run code or load resources. It checks the `SafeHtml` value at runtime, so a plain string
disguised as `SafeHtml` is rejected even if the code skipped TypeScript's checks.
Copied fields, casts, and JSON round trips cannot create an accepted `SafeHtml`
object. The same component displays browser-sanitized articles; keep the cleaned value in the parent
that coordinates fetching and DOM effects. See the [highlight lifecycle](sanitize.md#dom-side-interactive-highlights).

`SafeJsonScript` embeds data for application code to read, while `SafeJsonLdScript`
embeds [JSON-LD structured data](https://json-ld.org/) for search engines and other
tools. Both accept values that can be represented reliably as JSON: strings, booleans,
finite numbers, null, arrays, and ordinary objects. They copy the supplied data and
reject circular references, custom `toJSON` methods, symbols, class instances, and
other values whose conversion could be surprising.
They also escape characters that could end the script element or be interpreted
differently by JavaScript. This prevents embedded data from becoming executable HTML.
Client-side code can read data created by `SafeJsonScript` with `readJsonScript()`.

`SafeScriptBlock` and `SafeStyleBlock` accept only `SafeScript` and
`SafeStyleSheet`, optionally with a `CspNonce`. Use them only for small, fixed blocks
that have been reviewed. Put larger JavaScript and CSS in separate files.

## Responses

Applications use an explicit safe response interface for HTML. `SafeResponse` accepts
only `SafeHtml` or a `SafeStream`:

```tsx
import {withSafeRouteHandler} from "next-xss-sbyd/route-handler";
import {SafeResponse} from "next-xss-sbyd";
import {safeRenderToString} from "next-xss-sbyd/render";

export const GET = withSafeRouteHandler(function GET() {
  return new SafeResponse(safeRenderToString(<main>Safe HTML</main>), {status: 200});
});
```

Wrap every App Router HTTP export with `withSafeRouteHandler`, including JSON-only
routes. It checks the final content type and safe HTML body after the handler
returns, in Node or Edge. The recommended ESLint preset requires this wrapper;
run ESLint with `--fix` to migrate simple function exports. See the
[response validation API](../README.md#configure-the-response-guard) for forwarding,
streaming, and migration details.

Use `SafeNextResponse` instead when the response needs Next.js features such as its
cookie API. Do not pass safe objects to `Response` or `NextResponse`; those standard
constructors are for non-HTML responses and reject safe objects after
`installResponseGuard()` runs. The explicit safe constructors do not accept raw strings.

For a Pages Router or custom Node handler, wrap the handler once with
`withSafeApiRoute()` and pass `SafeHtml` to `safeSend()` or `safeEnd()`:

```tsx
import {withSafeApiRoute} from "next-xss-sbyd/enforce";
import {safeRenderToString} from "next-xss-sbyd/render";

export default withSafeApiRoute((_request, response) => {
  response.safeSend(safeRenderToString(<main>Safe HTML</main>));
});
```

The wrapper installs `response.safeSend(html)` and `response.safeEnd(html, callback?)`.
Both verify that the input is a `SafeHtml` object and reject raw strings. `safeSend()` returns `void` and
uses Next's original `send()` to preserve ETags, content length, conditional requests,
and bodyless-response handling; on a custom Node response it falls back to `end()`.
`safeEnd()` uses Node's original `end()`, passes its optional callback directly to Node,
and returns the response. It does not run Next's `send()` processing and has no encoding
argument: safe HTML is always UTF-8.

Use the exported `SafeApiResponse<Res = NextApiResponse>` type for named handlers and
shared HTML-sending helpers; it is available from the main package and
`next-xss-sbyd/enforce`. Inline handlers infer it. The type preserves the underlying
response's JSON body type and custom fields, and keeps safe methods available after
Next and Node chaining methods such as `status()`, `setHeader()`, and `setDraftMode()`.
Ordinary `NextApiResponse` is not globally augmented: an unwrapped response has no safe
methods, so forgetting the wrapper fails loudly.

Standard `send()`, `end()`, and `write()` reject `SafeHtml`, `SafeStream`, and
`SafeNodeStream`, even when a passive content type is set. They retain their ordinary
non-HTML behavior: passive-typed strings and bytes, objects, and empty responses remain
supported. Nonempty byte writes, including ordinary stream piping, require an effective
allowlisted passive type; missing, malformed, and active types are rejected. Next's
`send(Buffer)` still infers `application/octet-stream` before the guarded `end()` call.
Strings and bytes share the [expanded passive content allowlist](passive-content.md),
including common raster images, CSV, audio/video, fonts, and archives. PDF, SVG,
XML, and unknown types remain rejected. Downloads of excluded formats can use
`application/octet-stream` with `Content-Disposition: attachment` and an appropriate
filename. Inline active formats need a separately reviewed route with application-owned
validation of response content and headers.
A policy rejection during ordinary `Readable.pipe(response)` can escape Next's
handler error boundary and drop the connection, or truncate a response whose headers
were already committed. Set the passive type before piping and observe stream/socket
errors; a synchronous `try/catch` around `pipe()` does not catch later chunk failures.
`json()` and redirects continue to work. The wrapper defaults Next redirect
bodies to `text/plain; charset=utf-8` when no content type is set, and validates any
existing content type before Next commits the redirect headers. Node streams go through `safePipe()`;
Web streams go through `SafeResponse` or `SafeNextResponse`. There is no `safeWrite()`:
safe fragments cannot be concatenated without preserving the full parse context.

Each explicit HTML sink sets `Content-Type: text/html; charset=utf-8` and
`X-Content-Type-Options: nosniff`. These headers tell the browser to interpret the body
as UTF-8 HTML and not to guess a different content type. The APIs reject attempts to
replace either header, regardless of capitalization. Next may remove body headers when
its normal `safeSend()` processing produces a bodyless 204 or 304 response.

Standard `send()`, `end()`, and `write()` accept raw strings only when their
content type is on the passive-content whitelist. These calls do not produce HTML.
The [complete list and rationale](passive-content.md) describe the accepted types,
strict parameter parsing, `nosniff` recommendations, and excluded active formats.

### Configure the web application

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
`--import` option. See [why startup order matters](retrofit.md#set-node_options-for-builds-and-server-startup).

See the [hosting setup instructions](retrofit.md#managed-hosting-without-a-controllable-node-startup-command)
if your provider manages the build or server commands.

Run `next-xss-sbyd-check-guard .` in CI to check the instrumentation file and the
`package.json` production start script. It passes when either is configured, even
if the startup option is missing. See [deployment verification](retrofit.md#verify-the-deployed-behavior)
for the additional checks.

The lint rules assume the application has been set up as above.

## Removing unsafe alternatives

TypeScript can provide new APIs, but it cannot remove existing dangerous APIs such as
`dangerouslySetInnerHTML`, `new Response(string)`, or `res.send(string)`. Therefore:

- we provide safe replacements that reject plain strings; and
- ESLint rules reject use of the unsafe alternatives (`dangerouslySetInnerHTML`, etc.).

The recommended ESLint configuration uses TypeScript's type information. This lets a
rule recognize an unsafe API even when it has been imported under a different name. If
type information is unavailable, linting stops with an explanation instead of silently
skipping these checks. Dependencies, generated files, and the reviewed internals of
`next-xss-sbyd` are excluded.

ESLint reports unsafe API usage during development. At runtime, the replacement
`Response` constructor restricts raw strings to the permitted non-HTML content
types. To send HTML, use `SafeResponse` or `SafeNextResponse`; both verify that the
body is a `SafeHtml` or `SafeStream` created by the same package copy.

Each safe constructor verifies the body and headers before calling its parent
constructor. If that parent is this package's replacement for `Response`, it also
verifies the original safe object before extracting the body and setting the
security headers. Otherwise, the safe constructor supplies the already-checked
body and headers to the native constructor.

The constructors communicate through two shared, versioned JavaScript symbols.
One identifies a parent that supports these checks. The other identifies a safe
HTML constructor. Neither symbol grants permission to skip validation. Copying a
symbol, inheriting it, or using `Reflect.construct` cannot authorize a raw body.
Calls marked as safe HTML construction reject null and primitive bodies, even
with a permitted non-HTML content type.

Next.js can bundle multiple copies of this package. Each copy registers functions
that recognize its own safe objects, so the replacement `Response` and
`withSafeApiRoute()` can verify objects from those copies. This registry is mutable
and trusts loaded server code. Deliberately modifying it is outside the threat
model, as is replacing the native constructor.

Calls to `withSafeApiRoute()` also share a versioned weak set of responses that
already have its methods installed. Nested calls reuse those methods. The outer
call restores the original methods when the response completes, closes, or the
handler fails. This registry also trusts loaded server code.

## ESLint rules

The ESLint plugin exports two configurations. Use `recommended` to report unsafe
API usage as errors. During migration, use `lintMigration` to report warnings and
lower the permitted warning count as each problem is fixed. This prevents later
changes from silently adding more warnings.

`lintMigration` changes ESLint severity only. It does not relax the JSX runtime,
this package's replacements for Next.js `Link`, `Image`, and `Form`, or the HTTP
response checks. Partially migrated code can therefore fail when rendered
or tested if those runtime integrations are enabled. `lintMigration` keeps
`require-disable-justification` at error severity so findings cannot be hidden without
an explained, rule-specific exception. The security assumptions in this document
apply only after the application uses `recommended` and installs the JSX and HTTP
response checks.

The recommended configuration enables these rules:

| Rule | Result | What it checks |
| --- | --- | --- |
| `no-object-url` | error | Native object URL references and named access on unresolved receivers |
| `no-danger` | error | Raw HTML insertion in JSX |
| `no-unsafe-html-response` | error | Unchecked HTML in Fetch and Next.js responses |
| `no-unsafe-api-send` | error | Unsafe strings/bytes and safe objects sent through standard Node response methods; safe HTML requires `safeSend` or `safeEnd` |
| `require-safe-api-route` | error | Pages API default exports must include `withSafeApiRoute`, including within handler composition |
| `no-raw-render-to-string` | error | Direct use of React's server-rendering functions |
| `safe-jsx-urls-active` | error | URLs that can load active content |
| `require-safe-jsx-runtime` | error | JSX runtime configuration and direct bypasses |
| `no-html-content-type` | error | Content types outside the shared passive policy, malformed or dynamic values, and removed or weakened response security headers |
| `no-dynamic-script-style` | error | Changing data inside script and style blocks |
| `no-unsafe-cast-to-safe-type` | error | Type assertions and `any` values that bypass safe types |
| `require-disable-justification` | error | Broad or unexplained disabling of xss-sbyd rules |
| `no-html-template-strings` | error | Template strings that look like HTML |

See the [rule reference](../eslint-plugin-next-xss-sbyd/rules.md) for findings,
repairs, options, and autofix limits for each rule.

`no-html-template-strings` uses a heuristic that also matches intentional HTML test
fixtures and some non-HTML syntax. Review each finding and use a justified line-level
exemption where appropriate; the [retrofit guide](retrofit.md#resolve-html-template-string-errors)
shows examples. A lint exemption does not relax runtime sink checks.

`no-unsafe-api-send` can rename proven `SafeHtml` sends to `safeSend` or `safeEnd`
when the call shape is supported. Review the result and ensure the handler is wrapped.
Other findings need a context-specific repair: text, HTML, URL, JavaScript, or CSS.

## Prop spreads and runtime URL validation

Prop spreads in JSX are a source of XSS risk.
They can include `dangerouslySetInnerHTML` attributes, which smuggle
in raw HTML (and thus can introduce XSS vulnerabilities), but in a
way that is not easily visible at the element they influence.
`srcDoc` is also a source of XSS risk.

Therefore, we modify the JSX runtime so that these dangerous
attributes can only be used if their value is a safe branded
type, but not with raw strings.  (Alternatively, applications can
use `SafeBlock` instead.)

Our JSX runtime also validates URLs, and checks that active
URLs (which might introduce Javascript) use developer-controlled resources
and have the expected runtime-checked SafeValues type.
The JSX runtime checks HTML attributes on built-in elements such as `<a>`, `<img>`,
and `<form>`. It cannot inspect the implementation of a Next.js component. This
package therefore provides replacements for Next.js `Link`, `Image`, and `Form`.
They check `href`, `src`, and `action`, respectively, and reject raw HTML in
`dangerouslySetInnerHTML` or `srcDoc`.

Configure bundler aliases from `next/link`, `next/image`, and `next/form` to
`next-xss-sbyd/compat/link`, `next-xss-sbyd/compat/image`, and
`next-xss-sbyd/compat/form`. Configure both Turbopack and webpack so the same checks
apply in development and production.

Our JSX runtime is installed with
`compilerOptions.jsxImportSource = "next-xss-sbyd"`.
ESLint rules prevent bypassing or overriding this.

The compiler uses this JSX runtime in both Node.js and the browser. Applications
must also install the HTTP response checks described above. Those checks run in
Node.js and must be installed before Next.js loads its response constructors.
They do not run in the Next.js Edge runtime.

## CSP and response hardening

This package adds a strict CSP to HTML responses. For a new Next.js middleware or
proxy handler, use `createXssSbydHandler()`. To add CSP to an existing handler, use
`withXssSbydHeaders(inner)`. It preserves the existing handler's authentication,
locale, redirects, rewrites, cookies, and early responses. Make it the outermost
wrapper so it can set the final security headers.

For every request it:

1. creates a random 128-bit nonce;
2. replaces any nonce or CSP request headers supplied by the client;
3. gives Next.js the policy and nonce it needs for framework scripts;
4. preserves unrelated header changes made by the wrapped handler;
5. adds the CSP response header; and
6. adds headers that prevent content-type guessing and limit referrer information.

The default policy uses the nonce to approve eligible inline `<script>` and `<style>`
elements. It emits `style-src-attr 'unsafe-inline'` to allow ordinary style
attributes, including server-rendered React styles, without a nonce. There is no
option to deny style attributes. `style-src-elem 'self' 'nonce-…'` restricts inline
stylesheets to matching nonces in browsers that support it. The legacy fallback,
`style-src 'self' 'unsafe-inline'`, permits attributes and inline stylesheets without
nonces in older browsers.

Approved scripts may load their own dependencies. Other source rules restrict where
resources may come from, block plug-in content, prevent other sites from framing the
page, and limit where forms and relative URLs can point. Caller-supplied
`'unsafe-inline'`, `'unsafe-eval'`, and `'unsafe-hashes'` are rejected in every
source-list option:
`scriptSrc`, `styleSrc`, `connectSrc`, `imgSrc`, `fontSrc`, `mediaSrc`, `frameSrc`, and
`formAction`. Errors identify the option and offending source. Separator, whitespace,
and control-character checks also prevent injection of extra directives; this is not
a complete CSP grammar validator. Broad schemes (`data:`/`blob:`), wildcard sources,
and static nonce allowances remain the caller's responsibility. The builder separately adds trusted
`script-src 'unsafe-eval'` only in development for Next.js tooling. Production omits
it. Verify integrations with a production build, including post-hydration interactions.

Next.js 14 and 15 applications export the handler from `middleware.ts`; Next.js 16
applications export it from `proxy.ts`. Server components obtain the current nonce with
`getNonce()`.

Ordinary React style props and dependency-generated attributes can remain as they
are. Small fixed inline stylesheets can use `SafeStyleBlock` with literal-only
`safeStyleSheet` and the document nonce. A nonce authorizes CSS; it does not sanitize
it. Libraries inserting stylesheet elements still need nonce propagation or supported
external CSS. See the [style policy guide](csp-styles.md) and
[dependency integrations](csp-style-integrations.md).

A new nonce is created for each request, so this protection cannot be added to an HTML
page that is generated once and then cached. Such a page would keep the nonce embedded
in its cached scripts, while the handler would send a CSP header containing a different
nonce on every request; the browser would therefore block those scripts. Applications
must either omit Static, Incremental Static Regeneration (ISR), and Partial Prerendering
(PPR) routes from the middleware or proxy `matcher`, so those cached pages do not receive
the nonce-based policy, or opt those routes into dynamic rendering, so Next.js generates
fresh HTML with the request's nonce. During deployment, report-only mode can record
violations without blocking content. Enforcement mode should be used after those reports
have been addressed.

For staged rollout, `createCspReportHandler()` receives browser CSP violation
reports and passes them to application-owned storage. It limits payload sizes,
rejects malformed batches, and combines duplicate reports. Treat incoming reports
as untrusted: rate-limit the endpoint and apply the application's privacy and
retention policies. The `next-xss-sbyd-csp-suggest` command uses reports to propose
CSP configuration changes. Review each proposed source before allowing it.

## Restricted conversions

An existing application may use a custom sanitizer that this package cannot
recognize. A human security expert must review how the data is produced and used
and determine that it is XSS-safe. The APIs in `next-xss-sbyd/restricted` then mark
the data as reviewed and safe and return a safe type accepted by this package's
runtime. For example, `htmlSafeByReview()` returns `SafeHtml` for reviewed HTML.

The required justification records why the usage is safe. These APIs do not
inspect, escape, or sanitize the string themselves. Their safety depends on the
human review.

To find these calls and inline comments that disable xss-sbyd rules, start with:

```sh
rg 'next-xss-sbyd/restricted|eslint-disable.*xss-sbyd' .
```

Keep each lint disable limited to the line or section that needs it and state why the
code is safe. This makes exceptions easy to find during later reviews.

## Avoiding duplicate SafeValues packages

SafeValues records which values are safe using an internal marker. That marker belongs
to the installed copy of the `safevalues` package that created it. If an application
has two copies of `safevalues`, a value from one copy will not carry the marker expected by the other.
TypeScript cannot detect this difference, but `next-xss-sbyd` will reject the value at
runtime. This could break a legitimate application, so we must
avoid duplicate copies of `safevalues`.

To avoid this problem, import SafeValues builders from `next-xss-sbyd`. It re-exports
them from the same dependency copy used by its response APIs and components. Do not install or import
`safevalues` directly.

A duplicate package can cause runtime errors, but it does not weaken security. If an API
cannot verify a value's marker, it throws an error before sending the value.

Next.js may bundle `next-xss-sbyd` separately from the preloaded `Response` replacement.
The shared symbols and registry described above let these copies work together. Each
copy registers checks for its own safe objects. The replacement `Response` rejects
a `SafeHtml` object if its copy has not registered a check.

`SafeResponse` and `SafeNextResponse` accept only their own copy's safe objects,
whether or not `installResponseGuard()` has run. Use each copy's builders and
response constructors together. Do not mix
incompatible protocol versions or use duplicate packages as a substitute for deduping
dependencies. Tests cover registered cross-copy HTML and streams and unregistered
SafeValues rejection.

## Why this design

### Types and lint

Safe types let TypeScript check the new APIs, but TypeScript cannot remove the old,
unsafe APIs. ESLint can reject those old APIs, but it cannot record that a value was
checked and then follow that fact through the application as reliably as a safe type.
Using both means that a value can be checked once and then passed through ordinary
TypeScript code without repeated checks.

### Context-specific brands

HTML, form destinations, image URLs, script URLs, JavaScript, and CSS each have different
safety rules and require different sanitizers.
A separate type for each use prevents a value checked under one set of
rules from being used where a different set is required.

### No general HTML templates or concatenation

A value inserted into an HTML template might become text, an attribute, a URL, a tag
name, a comment, CSS, or JavaScript. Each location requires different handling. JSX
already identifies these locations, and React escapes ordinary text and attributes.
Creating a second template language would duplicate that work and make mistakes more
likely.

For the same reason, safe HTML fragments and stream chunks cannot be joined with a
general-purpose operation. A fragment that is safe alone may end inside an attribute or
script and change how the browser interprets the next fragment. React instead renders
the complete component tree while tracking the current location in the document.

### Fixed policies

A safe type should have one stable meaning. If each call could change sanitizer options
or silently relax the CSP defaults, two values of the same type could provide different
levels of protection. Fixed policies make such changes deliberate and visible during
review.

<a id="why-the-response-guard-is-a-separate-entry-point"></a>

### Load response checks before Next.js

`next-xss-sbyd/enforce/preload` installs validation on Node's `Response` constructor
and checks that unsafe responses are rejected. Its separate entry point lets
`NODE_OPTIONS="--import next-xss-sbyd/enforce/preload"` load it before Next.js.
This ordering is necessary for security: without the setting, `NextResponse` may
skip the validation that rejects unsafe HTML. Set the option for both builds and
server startup, and keep the instrumentation hook shown above.

### CSP as an independent layer

TypeScript and ESLint cannot inspect every dependency or detect every programming error.
If unsafe markup still reaches a page, CSP can prevent much of it from running as a
script. CSP is a backup; it does not replace safe construction.

## Security contract

When an application compiles, type-checks, passes the recommended ESLint configuration, 
and configures CSP correctly, common
server-side XSS mistakes cause a build or lint error. The remaining operations that can
emit HTML are small enough to review directly.

This guarantee has limits. Reviewers must still examine uses of
`next-xss-sbyd/restricted`, disabled rules, third-party components, sanitizer updates,
CSP reports, and browser-side code that modifies the page. The project also tests each
supported Next.js and React version because their rendering and request handling can
change.

## Appendix: response APIs

`SafeResponse`, `SafeNextResponse`, `response.safeSend()`, `response.safeEnd()`, and
`safePipe()` are the explicit HTML response APIs. Standard response APIs are for
non-HTML output and reject safe objects. The HTML APIs verify the safe object,
extract its body, and set fixed HTML and `nosniff` headers. They reject conflicting
headers.

| Sink | Input | Result |
| --- | --- | --- |
| `new SafeResponse(body, init?)` | `SafeHtml` or `SafeStream` | Fetch response |
| `new SafeNextResponse(body, init?)` | `SafeHtml` or `SafeStream` | Next response |
| `response.safeSend(html)` | `SafeHtml` | `void`; Next send semantics or Node end fallback |
| `response.safeEnd(html, callback?)` | `SafeHtml` | The response; native Node end semantics |
| `safePipe(response, stream, options?)` | `SafeNodeStream` | `void`; renderer-owned streaming |

The methods are installed by `withSafeApiRoute()` and preserve status selected with
`response.status(...)` or `response.statusCode`. There is no standalone `safeSend`
export. `safePipe()` accepts the stream returned by `safeRenderToPipeableStream()` and
owns renderer failure handling: before any HTML is sent it returns a fixed plain-text
500 response, and after sending begins it terminates the response. If a client
disconnects before rendering finishes, both ordinary and guarded responses abort
rendering and report React's "The destination stream closed early." error to
`options.onError`. A `SafeNodeStream`
cannot be connected to another response afterward because its rendering events and
error handling belong to the first response.
