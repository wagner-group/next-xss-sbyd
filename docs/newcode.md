# Building a new Next.js application with next-xss-sbyd

Use `next-xss-sbyd` from the first commit to prevent XSS through raw HTML, URLs,
script/style content, and HTTP responses. React escapes ordinary JSX text. This
package checks data at HTML and response APIs, prohibits unsafe APIs through ESLint,
and configures CSP.

This guide targets TypeScript, Next.js 14–16, and React 18–19. It covers server-side
XSS prevention and browser HTML sanitization and display.

## Set up enforcement

```sh
npm install next-xss-sbyd
npm install --save-dev eslint-plugin-next-xss-sbyd
```

In `eslint.config.mjs`:

```js
import xssSbyd from "eslint-plugin-next-xss-sbyd";

export default [...xssSbyd.configs.recommended];
```

Keep a discoverable `tsconfig.json`. Run `npx eslint .`, type-checking, and the
production build in CI. The sanitizer includes its dependencies.
Import SafeValues builders from `next-xss-sbyd` so they use the same dependency copy
as this package's HTML APIs.

Enable this package's validating JSX runtime to check HTML attributes on built-in
elements for XSS,
including attributes supplied through `{...props}` spreads:

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "next-xss-sbyd"
  }
}
```

Use `next-xss-sbyd/compat/link`, `next-xss-sbyd/compat/image`, and
`next-xss-sbyd/compat/form` to validate URLs passed to Next.js components. Configure
these aliases in `next.config.ts`:

```ts
import type {NextConfig} from "next";
import {withXssSbyd} from "next-xss-sbyd/next-config";

const aliases = {
  "next/link": "next-xss-sbyd/compat/link",
  "next/image": "next-xss-sbyd/compat/image",
  "next/form": "next-xss-sbyd/compat/form",
};

const config: NextConfig = {
  turbopack: {resolveAlias: aliases},
  webpack(config) {
    Object.assign(config.resolve.alias, aliases);
    return config;
  },
};

export default withXssSbyd(config);
```

`withXssSbyd` preserves your webpack callback and enables JSX import redirection by
default. It redirects bundled imports of `react/jsx-runtime` and
`react/jsx-dev-runtime` to this package's checking runtime, including imports in
precompiled dependencies. Next.js internals and this package's own runtime imports
are excluded to avoid recursion and interfering with framework rendering.
Keep `jsxImportSource` configured for application code as well. The wrapper adds
`next-xss-sbyd` and `safevalues` to `transpilePackages` so CommonJS dependencies
receive synchronous checking functions in Pages Router builds; it preserves your
existing entries. It also separates webpack's persistent cache when redirection
is enabled, so changing the opt-out setting does not reuse rewritten imports.

Use webpack for both development and production. On Next.js 16, use
`next dev --webpack` and `next build --webpack`; on Next.js 14/15, omit
`--turbo`/`--turbopack`. Turbopack does not support this redirection: the wrapper
throws when it detects Turbopack. To explicitly accept the reduced coverage, use
`withXssSbyd(config, {redirectJsxRuntime: false})`. The component aliases above are
still needed; keeping both alias configurations supports that opt-out. These three
modules use unaliased Next.js imports internally to avoid an alias loop.

Test dependencies with both ordinary and hostile input before deployment. Libraries
that insert raw HTML or use unsupported URLs may now throw even when their input
was previously accepted. Do not add a global unchecked-HTML exemption to restore
compatibility. Redirection does not check `React.createElement`, props introduced
later by `React.cloneElement`, server packages left external to the bundle, vendored
runtimes, or direct DOM writes. See [the remaining limits](caveats.md#third-party-components-and-dependencies).

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

These scripts use POSIX shell syntax. On Next.js 16, append `--webpack` to the
`next build` command. Preserve any existing build or start arguments.
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

The `NEXT_RUNTIME` condition runs installation in Node. Use Node for handlers that
need response validation. The ESLint rules require this setup.

## The default: ordinary JSX

React escapes string interpolation, so most content needs no special API:

```tsx
export function Profile({displayName}: {displayName: string}) {
  return <h1>{displayName}</h1>;
}
```

Do not encode this value yourself and do not use `dangerouslySetInnerHTML`.

The configured JSX runtime checks the final merged attributes on built-in HTML
elements. Every casing of `srcDoc` and every `dangerously*` prop is rejected unless the
supported HTML attribute contains a `SafeHtml` object created by this package. This includes props hidden in values
typed as `any`. Prefer `SafeBlock`; direct `dangerouslySetInnerHTML` remains a lint
error because `SafeBlock` explicitly requires `SafeHtml`.

## Safe API map

For URL props, **passive** means navigation or image/media use; **active** means a
resource can supply executable content, as with a script or iframe. A passive URL
check does not make that resource safe to serve as an HTML document.

| Avoid in application code | Use instead |
| --- | --- |
| `dangerouslySetInnerHTML` | JSX, or `SafeBlock` with `SafeHtml` |
| Passive URL props | Ordinary strings through the validating JSX runtime |
| Active-content URL props | `TrustedScriptUrl` |
| Dynamic inline `script` or `style` | JSON components, bundles, or literal safe blocks |
| HTML at `Response` / `NextResponse` | `SafeHtml` or `SafeStream` through `SafeResponse` / `SafeNextResponse` |
| Unwrapped Pages API handler | `withSafeApiRoute` around every handler, including JSON-only routes |
| HTML at `response.send` / `response.end` | `response.safeSend(SafeHtml)` / `response.safeEnd(SafeHtml, callback?)` |
| Direct React server renderers | `next-xss-sbyd/render` wrappers |
| Manual HTML content type | Let the safe response API set it |

## HTML and rich text

Use JSX for plain text. When an API explicitly requires a `SafeHtml` value:

```tsx
import {htmlEscape, SafeBlock} from "next-xss-sbyd";

<SafeBlock html={htmlEscape(userBiography)} />
```

For formatted, untrusted HTML, use the same import in Node and the browser:

```tsx
import {SafeBlock} from "next-xss-sbyd";
import {sanitizeUserHtml} from "next-xss-sbyd/sanitize";

export function RichText({html}: {html: string}) {
  return <SafeBlock as="article" html={sanitizeUserHtml(html)} />;
}
```

`sanitizeUserHtml` takes exactly one string and returns `SafeHtml` synchronously.
Its single policy retains formatting, images with validated URLs, native audio/video, and visible
`<mark>` wrappers, while stripping executable markup, styles, forms, IDs/names, and all
`data-*`. There is no public policy or options object. Edge and DOM-less workers are
unsupported and calls fail clearly.

Sanitized content can load resources. Restrict CSP image/media destinations according
to your application's privacy needs; keep script restrictions strict. Finish HTML-string
changes before sanitization. For fetched articles and saved highlights, keep `SafeHtml`
in the parent that owns readiness, then run effects after display. Never transport the
branded object through JSON or cast JSON into it: sanitize received strings again.
See the [exact API, migration, and executable highlight recipes](sanitize.md).

## URLs: automatic validation for passive sinks

```tsx
import Image from "next/image";
import Link from "next/link";

export function Example() {
  return <>
    <Link href="/docs">Documentation</Link>
    <Image src="https://images.example.com/default.png" alt="" width={48} height={48} />
    <form action="/settings/profile" method="post">...</form>
  </>;
}
```

The runtime validates raw strings on built-in HTML elements such as `<a>` and
`<img>` after resolving spreads. Navigation props allow root-relative, HTTP(S), `mailto:`, and `tel:` URLs;
passive resources allow root-relative and HTTP(S) URLs; form actions allow same-origin
root-relative targets. Invalid values throw. `next/image` static-import objects and
function-valued server actions pass through unchanged.

Active-content props such as `script[src]`, `iframe[src]`, executable `link[href]`, and
SVG resource references require a `TrustedScriptUrl` object created by this package; `base[href]` and
meta refresh are forbidden. Use `trustedScriptUrl` only for literal,
developer-controlled resources. Branded passive URL builders remain useful when code
needs to validate a URL before rendering it. Their return types record which checks
the URL passed: navigation, resource loading, or form submission. These values remain
strings without runtime identity markers, so the JSX runtime validates them again.

Use `SafeExternalIframe` instead of an intrinsic iframe. React's intrinsic `src` type accepts
only strings and cannot express the required safe value:

```tsx
import {SafeExternalIframe, trustedScriptUrl} from "next-xss-sbyd";

<SafeExternalIframe
  src={trustedScriptUrl`https://video.example/embed/player`}
  sandbox="allow-scripts"
  title="Product video"
  loading="lazy"
/>
```

The component verifies `TrustedScriptUrl` at runtime and accepts only `sandbox=""`
or `sandbox="allow-scripts"`. The empty profile is suitable for static HTML documents;
use the latter only when the framed document must run scripts. The component forbids
`allow-same-origin`, `srcDoc`, and `dangerously*` props. Configure CSP `frameSrc` with
only the exact iframe origins you need; the default is `frame-src 'none'`.

Native PDF viewing can fail silently under both supported sandbox profiles, even
when the endpoint returns HTTP 200 and `application/pdf`. Prefer an ordinary
open/download link; see [Native PDF viewing](caveats.md#native-pdf-viewing).

Encode dynamic pieces explicitly:

```ts
import {
  navigationUrl,
  pathSegment,
  queryValue,
  relativePath,
  relativeResourcePath,
  withQuery,
} from "next-xss-sbyd";

const page = relativePath("/products", pathSegment(id));
const image = relativeResourcePath("/product-images", pathSegment(id), ".webp");
const search = withQuery(navigationUrl("/search"), {q: queryValue(searchText)});
```

Use `navigationUrlOrNull` or `resourceUrlOrNull` when an invalid optional URL should
remove a link or resource.

These nullable variants cover only `navigationUrl` and `resourceUrl`. Builders such
as `pathSegment`, `relativePath`, `relativeResourcePath`, and `withQuery` still throw;
reject or normalize invalid dynamic pieces when reading request or stored data.
Use the throwing builders when invalid stored application data is an error that should
surface.

## JSON, JSON-LD, scripts, and styles

Send client state as JSON data that the browser does not execute:

```tsx
import {SafeJsonScript} from "next-xss-sbyd";

<SafeJsonScript id="initial-state" data={{theme: "dark", accountId}} />
```

Read it in client code:

```ts
import {readJsonScript} from "next-xss-sbyd";

const state = readJsonScript<{theme: string; accountId: string}>("initial-state");
```

Use `SafeJsonLdScript` for structured data:

```tsx
import {SafeJsonLdScript} from "next-xss-sbyd";

<SafeJsonLdScript data={{
  "@context": "https://schema.org",
  "@type": "Product",
  name: product.name,
}} />
```

The components accept JSON values and reject unsupported objects such as class
instances or cyclic structures. They escape text such as `</script>` so data cannot
close the script element and introduce new markup. Pass data, not a JSON string.

Prefer bundles and stylesheets. If a literal inline block is necessary:

```tsx
import {safeScript, safeStyleSheet, SafeScriptBlock, SafeStyleBlock} from "next-xss-sbyd";
import {getNonce} from "next-xss-sbyd/csp";

export default async function Page() {
  const nonce = await getNonce();
  return <>
    <SafeScriptBlock nonce={nonce} script={safeScript`globalThis.ready = true;`} />
    <SafeStyleBlock nonce={nonce} css={safeStyleSheet`.notice { font-weight: 600; }`} />
  </>;
}
```

These templates are literal-only security decisions. Never interpolate request data.

## HTML responses and rendering

Build Route Handler HTML as a React tree:

```tsx
import {withSafeRouteHandler} from "next-xss-sbyd/route-handler";
import {SafeResponse} from "next-xss-sbyd";
import {safeRenderToString} from "next-xss-sbyd/render";

export const GET = withSafeRouteHandler(async function GET() {
  const message = await loadMessage();
  return new SafeResponse(
    safeRenderToString(<main><h1>Status</h1><p>{message}</p></main>),
    {status: 200, headers: {"Cache-Control": "no-store"}},
  );
});
```

Wrap every App Router HTTP export with `withSafeRouteHandler`, including JSON-only
routes. It checks the final content type and safe HTML body after the handler
returns, in Node or Edge. The recommended ESLint preset requires this wrapper;
run ESLint with `--fix` to migrate simple function exports. See the
[response validation API](../README.md#configure-the-response-guard) for forwarding,
streaming, and migration details.

`SafeResponse` verifies that the body is a `SafeHtml` object created by this
package. It sets
`Content-Type: text/html; charset=utf-8` and `X-Content-Type-Options: nosniff` and
rejects attempts to override them. Use `SafeNextResponse` when Next.js-specific
response features such as its cookie API are needed. Keep normal platform APIs for
non-HTML responses, and do not pass `SafeHtml` or `SafeStream` to those APIs.

For a Pages Router API route:

```tsx
import type {NextApiRequest} from "next";
import {withSafeApiRoute, type SafeApiResponse} from "next-xss-sbyd/enforce";
import {safeRenderToString} from "next-xss-sbyd/render";

export default withSafeApiRoute(function handler(
  _request: NextApiRequest,
  response: SafeApiResponse,
) {
  response.safeSend(safeRenderToString(<p>HTML response</p>));
});
```

`withSafeApiRoute()` installs the two explicit HTML methods. `safeSend()` returns `void`
and preserves Next's ETag, content length, conditional response, and bodyless-response
behavior. `safeEnd(html, callback?)` returns the response and forwards its callback to
Node's native `end()`, without Next's send processing. Both preserve the selected status
and reject raw strings and streams. Use `safePipe()` for a `SafeNodeStream`.

Keep ordinary `json()`, redirects, and passive-typed `send()`/`end()`/`write()` for
non-HTML output. Those standard methods reject safe HTML and stream objects even when
the content type is passive. The safe methods are absent on unwrapped responses.
`SafeApiResponse` preserves fluent `status()`/`setHeader()`/`setDraftMode()` chains;
use `SafeApiResponse<NextApiResponse<Data>>` for a typed JSON body or supply your custom
response type. Inline callbacks infer the safe response type automatically.
`require-safe-api-route` requires a wrapper in every Pages API default export and accepts
composition such as `withAuth(withSafeApiRoute(handler))`.

For a Web stream:

```tsx
import {SafeResponse, trustedScriptUrl} from "next-xss-sbyd";
import {safeRenderToReadableStream} from "next-xss-sbyd/render";

const stream = await safeRenderToReadableStream(
  <html><body>...</body></html>,
  {bootstrapScripts: [trustedScriptUrl`/client.js`]},
);
return new SafeResponse(stream);
```

Import renderers from `next-xss-sbyd/render`. Their stream objects hide the raw chunks
so applications cannot concatenate or transform them. The `bootstrapScripts` and
`bootstrapModules` options name code the browser loads to start the rendered page;
their URLs require `TrustedScriptUrl`. Keep lint enabled to catch changes to
response headers after construction. The response APIs are described further in the
[design appendix](design.md#appendix-response-apis).

## Enable nonce CSP

Next.js 14 and 15 use `middleware.ts`; Next.js 16 uses `proxy.ts`:

```ts
import {createXssSbydHandler} from "next-xss-sbyd/csp";

export const middleware = createXssSbydHandler();

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

If the application uses the `SafeExternalIframe` example above, pass its exact origin through
`frameSrc`, for example:

```ts
export const middleware = createXssSbydHandler({
  frameSrc: ["https://video.example"],
});
```

Keep the default `frame-src 'none'` when the application does not render frames.

In Next.js 16, name the export `proxy`. If auth or locale middleware exists, wrap it:

```ts
import {withXssSbydHeaders} from "next-xss-sbyd/csp";

export const middleware = withXssSbydHeaders(authAndLocaleMiddleware);
```

The wrapper must be outermost. It creates a fresh nonce, forwards the request CSP Next
uses to nonce framework scripts, and sets response CSP, `nosniff`, and referrer policy.
The builder rejects caller-supplied `unsafe-inline` and `unsafe-eval`; only the
internal development policy adds `unsafe-eval`.

Per-request nonce CSP requires HTML generated for that request. Exclude cached static
pages, Incremental Static Regeneration (ISR), and Partial Prerendering (PPR) routes from
the matcher or make protected routes dynamic. For complex integrations, begin with
`mode: "report-only"` and a same-origin `reportUri`, fix reports, then enforce.
The [CSP rollout guide](csp-rollout.md) provides a hardened report endpoint,
report-to-policy CLI, application profiles, and an enforcement-readiness test.

## Exceptional code and completion criteria

`next-xss-sbyd/restricted` lets a human security expert mark data as reviewed and
XSS-safe when this package's built-in APIs cannot recognize its safety. The APIs
create safe values accepted by the runtime. They do not sanitize the data.

For example, an application-specific sanitizer may support formatting that
`sanitizeUserHtml()` does not retain. After a security expert reviews the sanitizer
and its policy, isolate the restricted call in one function and record what was reviewed:

```ts
import {unsafeHtmlDoNotUseOrReviewCarefully} from "next-xss-sbyd/restricted";

export function sanitizeDiagramHtml(input: string) {
  const sanitized = diagramSanitizer.sanitize(input, diagramPolicy);
  return unsafeHtmlDoNotUseOrReviewCarefully(
    sanitized,
    "diagramSanitizer v4 with diagramPolicy; no script, style, URL, SVG, or event-handler output; SEC-247",
  );
}
```

The restricted call records the human review and creates a `SafeHtml` object. It
does not verify that the external sanitizer or policy is safe. Pin and test both, keep the wrapper small, and
render the returned `SafeHtml` through `SafeBlock`. A lint disable does not bypass the
JSX runtime, and a raw string at `dangerouslySetInnerHTML` still throws.

```sh
rg 'next-xss-sbyd/restricted|eslint-disable.*xss-sbyd' .
```

The application is using the model correctly when:

- user text stays in JSX;
- rich HTML passes through the fixed sanitizer;
- each dynamic URL is validated for its use, and active resources use `TrustedScriptUrl`;
- data scripts use the JSON components;
- HTML responses and renderer streams use paired safe APIs;
- protected dynamic routes have a verified nonce CSP;
- the recommended preset is configured to fail continuous integration on errors; and
- restricted imports and justified disables form a short reviewed list.

Types protect safe sinks, lint removes unsafe sinks, and CSP limits the impact of a
mistake that survives both.
