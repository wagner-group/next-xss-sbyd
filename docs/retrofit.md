# Retrofitting an existing Next.js application

Use `next-xss-sbyd` to replace unsafe HTML, URL, script, and response APIs in an
existing application. Start with ESLint findings, enable this package's runtime
checks after fixing the code, then roll out CSP.

This guide applies to TypeScript applications using Next.js 14–16 and React 18–19.
It covers server-rendered HTML, URL attributes, inline code, HTML responses, custom
rendering, middleware/proxy CSP, and sanitized browser HTML display.

For Markdown rendering sites, follow the [Markdown/MDX migration guide](markdown.md)
for `SafeMarkdown`, existing HTML parsers, the optional lint preset and fidelity checks.

## 1. Install and inventory

Ordinary React style props and dependency-generated attributes are allowed by the
default `style-src-attr 'unsafe-inline'`. Keep existing attributes; stylesheet elements
need a matching nonce in browsers supporting `style-src-elem`. Older browsers allow
inline stylesheets through the legacy fallback. See the [style policy guide](csp-styles.md).

This package's command-line tool records a setup stage that can advance but cannot be lowered in `package.json`:

```sh
npx next-xss-sbyd enable-config . --stage lint --dry-run
npx next-xss-sbyd enable-config . --stage lint --yes
npx next-xss-sbyd check-config . --stage lint
npx next-xss-sbyd audit . --allow-migration --recommended --json > xss-sbyd-audit.json
```

Advance through `lint`, `runtime`, `recommended`, `csp-report`, and `enforce`. The
`recommended` stage is separate so lint regressions can become errors after runtime
testing without waiting for a CSP reporting pipeline. Existing executable configs are
never rewritten: the CLI prints a manual patch and withholds the stage marker until
all required edits validate. In CI, `check-config` defaults to the recorded stage (or
`enforce` when no stage is recorded). `check-config` and `audit` are read-only.

`enable-config` accepts `--no-install` to list dependency installation as a manual
step, `--sanitize-node` as an accepted legacy no-op (dependencies are included), and `--force` to
overwrite a generated target that has uncommitted changes. Without `--yes`, it asks
for confirmation on an interactive terminal; non-interactive callers must use
`--yes` or `--dry-run`. Existing executable configuration still requires manual
editing, even with `--force`. The current `check-config` checks do not verify JSX
import redirection; install and test the `withXssSbyd` wrapper below even if the
configuration check passes.

An audit finding is a reported problem or location that needs review, not proof
of an exploitable vulnerability. A baseline is a saved audit used for comparison.
Lower the warning limit as problems are fixed so CI rejects increases.

`audit` accepts `--baseline <file>` to compare per-rule finding counts with a
versioned JSON audit, and `--fail-on-warning` makes warning-only reports fail. The
`--allow-migration` option selects `lint` only when no explicit `--stage` is given;
`--stage` always takes precedence. `check-config` also accepts
`--fail-on-warning`. `check-config` verifies that `require-safe-api-route` is enabled
at the selected preset's severity; `audit` reports missing Pages API wrappers under
`api-route-setup`. These are per-handler remediation findings and count toward the
warning limit. Its response inventory includes safe constructors and explicit
`safeSend`, `safeEnd`, and `safePipe` sinks; review these heuristic sites manually.
An empty response inventory passes without a manual-review action. The
`runtime.pending` reminder at `lint` and `csp.pending` reminder at `lint`, `runtime`,
and `recommended` are informational passes: those protections are outside the
selected stage. They do not claim those protections are installed. Clean audits
can therefore pass `--fail-on-warning` at each of the five stages.

`runtime.preload-order` passes only when the parsed `package.json` `scripts.start`
contains the response-guard `--import` flag. Mentions in development or test scripts
and other package fields do not qualify. This checks declared configuration, not
actual execution order; retain the preload in every deployed server command.
Instrumentation alone still produces a preload-order warning.

Configuration or finding errors exit 1, invocation and analysis
failures exit 2, and a passing command exits 0.

```sh
npm install next-xss-sbyd
npm install --save-dev eslint-plugin-next-xss-sbyd
```

The sanitizer uses direct package dependencies; do not install
`isomorphic-dompurify` for it.

Start with the static migration preset in `eslint.config.mjs`:

```js
import xssSbyd from "eslint-plugin-next-xss-sbyd";

export default [...xssSbyd.configs.lintMigration];
```

The application needs a `tsconfig.json` discoverable by the TypeScript project
service. Run `npx eslint .` directly. `lintMigration` preserves every recommended
rule and option but reports its security findings as warnings. The flat config is
named `xss-sbyd/lint-migration`, so `--inspect-config` identifies the temporary
downgrade. Limit remediation findings in CI:

```sh
npx next-xss-sbyd audit . --allow-migration --max-warnings 137
```

Record the remediation total as the initial value, reduce the number whenever findings
are fixed, and never raise it. Setup diagnostics such as the per-file
`require-safe-jsx-runtime` `config` message are reported separately, so adding or
removing a clean file does not change this count.

This is a static-code workflow, not a compatibility mode for running a partially
migrated application. The preset changes ESLint severity only. It does not relax the
JSX runtime, URL checks in `next-xss-sbyd/compat/link`,
`next-xss-sbyd/compat/image`, and `next-xss-sbyd/compat/form`, or HTTP response checks. If those runtime integrations are enabled before the reported code is
fixed, rendered pages and tests can throw. During this phase, use lint to modify the
source without deploying or relying on the modified application to run.

When the security findings reach zero, enable the runtime checks: set
`compilerOptions.jsxImportSource` to `next-xss-sbyd`; configure both
`turbopack.resolveAlias` and `config.resolve.alias` for `next/link`, `next/image`, and
`next/form`; wrap the Next.js configuration with `withXssSbyd` from
`next-xss-sbyd/next-config`; and call `installResponseGuard()` as described in section 5.
The wrapper enables redirection of bundled React JSX runtime imports by default,
including imports in precompiled dependencies. Use webpack in development and
production (`--webpack` on Next.js 16). Turbopack is unsupported unless redirection
is explicitly disabled with `withXssSbyd(config, {redirectJsxRuntime: false})`. The complete
runtime configuration is shown in the
[new-code guide](newcode.md#set-up-enforcement). Test representative pages and hostile
inputs before deploying the runtime and aliases, then change the exported preset:

```js
export default [...xssSbyd.configs.recommended];
```

Finally, roll out CSP in report-only mode and enforce it after reviewing reports.

The static migration preset does not downgrade `require-disable-justification`:
removing or hiding findings is an enforcement change, not incremental remediation. The
presets ignore dependencies and generated output but intentionally check application
tests and stories because they can be server-rendered.

Import SafeValues builders from `next-xss-sbyd`, not directly from `safevalues`. A
value made by another physical package copy may be rejected by this package's
HTML APIs. Deduplicate dependencies and use the re-exported builders.

## 2. Replace raw HTML insertion

Ordinary JSX interpolation is already escaped by React:

```tsx
export function Greeting({ name }: { name: string }) {
  return <p>Hello, {name}</p>;
}
```

Prefer this over `dangerouslySetInnerHTML`. If an API specifically needs `SafeHtml`,
escape plain text and use `SafeBlock`:

```tsx
import { htmlEscape, SafeBlock } from "next-xss-sbyd";

return (
  <SafeBlock as="section" className="comment" html={htmlEscape(comment)} />
);
```

For untrusted formatted HTML from a user or CMS, sanitize in Node or the browser:

```tsx
import { SafeBlock } from "next-xss-sbyd";
import { sanitizeUserHtml } from "next-xss-sbyd/sanitize";

export function Article({ bodyHtml }: { bodyHtml: string }) {
  return <SafeBlock as="article" html={sanitizeUserHtml(bodyHtml)} />;
}
```

The single policy retains formatting, tables, links and images with validated URLs, native audio/video,
and visible `<mark>` wrappers. It strips scripts, styles, handlers, forms, frames, SVG,
MathML, templates, IDs/names, all `data-*`, and ID-reference attributes. Every retained
link URL gets `rel="nofollow noopener noreferrer"`, including root-relative links.

Remove `inertRichTextPolicy`/`NamedHtmlPolicy` imports and the second argument to old
calls. Extra arguments now throw. Existing one-argument `sanitize-node` calls may keep
their import, but must review the new resource-loading behavior. Review CSP `img-src`
and `media-src`; do not weaken script restrictions to recover pictures.

Finish HTML-string transformations before sanitizing. For browser fetches, sanitize in
the parent, store `SafeHtml`, render `SafeBlock`, then restore saved highlights in an
effect with stale-result protection and cleanup. Imported annotation metadata is
removed. [Executable recipes and the exact policy](sanitize.md) describe both supported
highlight workflows, URL/fidelity limits, and receiving strings through JSON.

Edge and DOM-less workers cannot sanitize: use a supported browser or Node environment,
or `htmlEscape` for literal text. Do not cast stored or transported data into `SafeHtml`.

### Resolve HTML template string errors

`xss-sbyd/no-html-template-strings` flags interpolated template literals whose static
parts contain `<` followed by a letter or `!`, excluding regex negative-lookbehind
markers such as `(?<!test.)`. Tags, comments and doctypes still match after regex-like
prefixes. This is a heuristic, not proof that the string reaches an HTML sink. Review
what consumes the string before choosing a repair. Static templates without interpolation are outside this rule's scope;
a clean lint result does not make arbitrary HTML safe. Interpolated tag names,
concatenation and array joins can also evade this heuristic; the absence of a finding
is not a security review or a substitute for runtime checks on `SafeHtml` objects.

| Finding | What to do |
| --- | --- |
| Application markup such as `` `<p>${name}</p>` `` | Use `<p>{name}</p>` in a `.tsx` file. When a server API needs `SafeHtml`, use `safeRenderToString` as shown below. |
| User or CMS rich text | Pass the original HTML through `sanitizeUserHtml` and render with `SafeBlock`, as above. Keep ordinary text in JSX or use `htmlEscape` when a safe HTML value is required. |
| Deliberately hostile HTML in a security test | Preserve the attack bytes. Use a justified line-level exemption; escaping or sanitizing the fixture before it reaches the code under test would weaken the test. |
| Benign archive or highlight fixture markup | Prefer JSX if equivalent. If the test needs exact raw markup, review the interpolations and add a line-level exemption explaining that requirement. |
| Non-HTML syntax: email headers, CLI usage text, generated TypeScript, SQL, shell heredocs, Markdown autolinks, or log messages | Verify the actual consumer and document a false positive with a line-level exemption. Angle brackets in these languages can resemble tags; this rule does not validate their escaping or safety. |

For server-generated HTML, replace string interpolation with JSX rendering:

```tsx
import { safeRenderToString } from "next-xss-sbyd/render";

const html = safeRenderToString(<p>Hello, {name}</p>);
```

This returns `SafeHtml`; send it through `SafeResponse` or `response.safeSend`,
or render it with `SafeBlock`. Follow the URL and script/style rules for those
contexts; JSX text escaping alone does not cover them.

Put `eslint-disable-next-line` immediately before the template's opening line,
naming the rule and giving a reason after `--`. For multiline fixtures, placing the
comment inside the template before its markup does not suppress the finding:

```ts
// eslint-disable-next-line xss-sbyd/no-html-template-strings -- Intentional hostile input for the sanitizer browser test
const attack = `
<img src="${url}" onerror="alert(1)">
`;

// eslint-disable-next-line xss-sbyd/no-html-template-strings -- Exact archive fixture markup; id is test-controlled
const archive = `<p id="${id}">Highlight seed</p>`;

// eslint-disable-next-line xss-sbyd/no-html-template-strings -- CLI help text written only to the terminal, never rendered as HTML
const usage = `Usage: ${command} <file> [options]`;
```

Do not rewrite templates as string concatenation to evade the check, or disable the
rule for an entire test directory. Test helpers can still contain unsafe sinks.
There is no autofix because the right repair depends on the consumer and test intent.
Keep exemptions visible in audit output and review them alongside restricted imports
in section 7. A lint exemption does not bypass runtime checks on `SafeHtml` objects.

## 3. Enable automatic URL validation

For URLs, passive uses are navigation, images, and media; active uses such as
script and iframe sources can supply executable content. URL validation checks the
address for that use. A passive HTTP content type is a separate concept: a type
accepted as data rather than an executable document by the response APIs. Validating
a URL does not validate the bytes downloaded from it.

Choose by what the browser does with the URL:

| JSX sink                                        | Runtime policy                                   |
| ----------------------------------------------- | ------------------------------------------------ |
| `a[href]`, `area[href]`, `Link[href]`           | Validate raw strings as navigation URLs          |
| passive `src`, `srcSet`, `poster`, `Image[src]` | Validate raw strings as passive resources        |
| `form[action]`, `formAction`, `next/form`       | Validate raw strings as same-origin form targets |
| `script[src]`, `iframe[src]`, executable links  | Require a `TrustedScriptUrl` object from this package           |

```tsx
import Link from "next/link";
import Image from "next/image";
export function Links({
  profile,
  avatar,
}: {
  profile: string;
  avatar: string;
}) {
  return (
    <>
      <Link href={profile}>Profile</Link>
      <Image src={avatar} alt="" width={64} height={64} />
      <form action="/account/save" method="post">
        ...
      </form>
    </>
  );
}
```

For built-in HTML elements, the JSX runtime checks the final attributes, including
values introduced through spreads. Invalid URLs always throw. This package's
`next-xss-sbyd/compat/link`, `next-xss-sbyd/compat/image`, and
`next-xss-sbyd/compat/form` apply the same URL checks to Next.js components. Static
`next/image` imports and function server actions pass through unchanged. Keep active resources developer-controlled and construct them with
`trustedScriptUrl`; do not turn user or database data into a script or frame source.

On built-in HTML elements, the JSX runtime also rejects `srcDoc` in any casing and
every `dangerously*` attribute unless a supported HTML attribute contains a
`SafeHtml` object created by this package. Once ESLint
verifies `jsxImportSource: "next-xss-sbyd"`, `no-danger` stops reporting JSX spreads
because the runtime checks the final merged props even when a spread is typed as `any`.
Explicit raw-HTML attributes remain lint errors, as do raw-HTML props passed through
`createElement` or `cloneElement`. `withXssSbyd` makes a best-effort attempt to
partially mitigate third-party library risk by applying these checks to more dependency rendering. Coverage remains
incomplete, and libraries can still produce unsafe HTML. Review security-sensitive
dependencies and [the remaining limits](caveats.md#third-party-components-and-dependencies).
Existing raw-HTML or unsupported-URL uses in dependencies may now throw; test
representative pages before deployment.
Applications that
cannot select this JSX runtime, including those
that require another `jsxImportSource`, must retain explicit lint protection for
spreads.

Replace intrinsic iframes with `SafeExternalIframe`. This solves the mismatch between React's
string-only iframe `src` type and the `TrustedScriptUrl` required for active content,
and adds a fixed sandbox policy:

```tsx
import { SafeExternalIframe, trustedScriptUrl } from "next-xss-sbyd";

export function ArchivedPage({ assetId }: { assetId: string }) {
  return (
    <SafeExternalIframe
      src={trustedScriptUrl`/api/assets/${assetId}`}
      sandbox=""
      title="Archived page"
    />
  );
}
```

The template builder percent-encodes `assetId`; do not replace it with string
interpolation. Keep the fixed `/api/assets/` prefix and review literal URL syntax for
[backslashes or empty interpolations that can change the origin](caveats.md#sanitization-and-trusted-content-decisions).
Choose `sandbox=""` for static HTML documents or
`sandbox="allow-scripts"` when the framed document must execute scripts.
`SafeExternalIframe` deliberately rejects `allow-same-origin`, including its combination with
`allow-scripts`, because a document that becomes same-origin could remove its sandbox.
It also rejects `srcDoc` and `dangerously*` props. Add only the required sources to the
CSP, such as `frameSrc: ["'self'"]` for the route above or an exact HTTPS origin for a
third-party frame. The CSP default is `frame-src 'none'`.

Native PDF viewing can fail silently under both supported sandbox profiles, even
when the endpoint returns HTTP 200 and `application/pdf`. Prefer an ordinary
open/download link; see [Native PDF viewing](caveats.md#native-pdf-viewing).

Some active sinks do not have a typed JSX carrier. Migrate them as follows:

- Replace `script[src]` with a normal application bundle when possible. For
  bootstrap files (browser code that starts the rendered page), pass `TrustedScriptUrl` values to `safeRenderTo*()`.
  Use `SafeScriptBlock` only for small,
  reviewed literal inline code; it is not a replacement for a dynamic external URL.
- Let Next.js manage stylesheet links. Other executable `link[href]` uses remain
  reviewed exceptions.
- Do not migrate `embed` or `object` to a wrapper; the fixed CSP blocks them with
  `object-src 'none'`.
- Uncommon active SVG `href`/`xlinkHref` sinks have no typed JSX carrier and remain
  reviewed exceptions. Prefer ordinary passive images or reconstruct the graphic as
  application-owned JSX when possible.

The active-URL lint rule checks intrinsic elements, not `SafeExternalIframe`; the component's
prop type requires `TrustedScriptUrl`, and its runtime checks verify the object
was created by this package.

Encode dynamic data as data, not URL syntax:

```ts
import {
  navigationUrl,
  pathSegment,
  queryValue,
  relativePath,
  relativeResourcePath,
  withQuery,
} from "next-xss-sbyd";

const detail = relativePath("/products", pathSegment(productId));
const image = relativeResourcePath("/images", pathSegment(productId), ".png");
const search = withQuery(navigationUrl("/search"), {
  q: queryValue(userSearch),
});
```

Use `navigationUrlOrNull` or `resourceUrlOrNull` when invalid optional user input should
make a link or resource disappear.

These nullable variants cover only `navigationUrl` and `resourceUrl`. Composed builders such
as `pathSegment`, `relativePath`, `relativeResourcePath`, and `withQuery` still throw;
reject or normalize invalid dynamic pieces when reading request or stored data.
Use the throwing builders when invalid stored application data is an error that should
surface. `navigationUrl()`, `resourceUrl()`, and `formActionUrl()` validate URLs
before rendering. Their return types record which checks the URL passed. These
values are strings with TypeScript brands, without runtime identity markers. The
JSX runtime validates them again; these brands are optional for passive URL props.

## 4. Replace inline script and style content

Keep ordinary style attributes. This section addresses the contents of script and
stylesheet elements, whose safe construction and nonce requirements still apply.

Do not interpolate JSON into a script string. Use an inert JSON block:

```tsx
import { SafeJsonScript } from "next-xss-sbyd";

<SafeJsonScript id="page-state" data={{ user: { id, displayName } }} />;
```

Read it in client code:

```ts
import { readJsonScript } from "next-xss-sbyd";

const state = readJsonScript<{ user: { id: string; displayName: string } }>(
  "page-state",
);
```

For structured data:

```tsx
import { SafeJsonLdScript } from "next-xss-sbyd";

<SafeJsonLdScript
  data={{
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
  }}
/>;
```

These components accept JSON values, snapshot plain objects and arrays, reject cycles
and class instances, and escape `</script>` so data cannot close the element. Pass
data directly rather than calling `JSON.stringify()` first.

Prefer bundled JavaScript and stylesheets. For static inline code or CSS:

```tsx
import {
  safeScript,
  safeStyleSheet,
  SafeScriptBlock,
  SafeStyleBlock,
} from "next-xss-sbyd";
import { getNonce } from "next-xss-sbyd/csp";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nonce = await getNonce();
  return (
    <>
      <SafeStyleBlock nonce={nonce} css={safeStyleSheet`body { margin: 0; }`} />
      <SafeScriptBlock
        nonce={nonce}
        script={safeScript`globalThis.appReady = true;`}
      />
      {children}
    </>
  );
}
```

`safeScript` and `safeStyleSheet` are literal templates, not contextual encoders.
Never interpolate request data.

## 5. Replace hand-built HTML responses

For an App Router Route Handler, express the body as JSX:

```tsx
import {withSafeRouteHandler} from "next-xss-sbyd/route-handler";
import { SafeResponse } from "next-xss-sbyd";
import { safeRenderToString } from "next-xss-sbyd/render";

export const GET = withSafeRouteHandler(async function GET() {
  const title = await loadTitle();
  return new SafeResponse(safeRenderToString(<h1>{title}</h1>), { status: 200 });
});
```

Wrap every App Router HTTP export with `withSafeRouteHandler`, including JSON-only
routes. It checks the final content type and safe HTML body after the handler
returns, in Node or Edge. The recommended ESLint preset requires this wrapper;
run ESLint with `--fix` to migrate simple function exports. See the
[response validation API](../README.md#configure-the-response-guard) for forwarding,
streaming, and migration details.

### Configure the web application

Every application must complete both steps to enable response validation:

1. Add the instrumentation hook below.
2. Set `NODE_OPTIONS` for builds and server startup, as shown in the next section.

Create `instrumentation.ts` at the application root, or `src/instrumentation.ts`
if the application uses `src/`:

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    (await import("next-xss-sbyd/enforce")).installResponseGuard();
  }
}
```

The `NEXT_RUNTIME` condition runs installation in Node. Use Node for handlers that
need response validation. On Next.js 14, also add
`experimental: {instrumentationHook: true}` to your existing Next configuration.

#### Set `NODE_OPTIONS` for builds and server startup

`NODE_OPTIONS` supplies startup options to Node. Set it to
`--import next-xss-sbyd/enforce/preload` to load response validation before Next.js.
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

Keep any other required `NODE_OPTIONS` flags alongside the `--import` option. If your
build and server run in different environments, set the variable in both. For a
custom Node server, set it in the environment that launches that server too.

**This setting is necessary for security.** Without it, `NextResponse` may skip
validation and send unsafe HTML to the browser. Next.js can load `NextResponse`
before calling the instrumentation hook; the class then keeps using the original
`Response` constructor. Setting `NODE_OPTIONS` ensures that validation is installed
when Next.js loads that class.

Once enabled, validation accepts raw strings with a content type in the
[shared passive content policy](passive-content.md), including plain text, JSON,
CSV, and event streams. HTML, XHTML, SVG, JavaScript, CSS, XML, missing or malformed
types, and unlisted types throw. Other non-string bodies pass through unchanged;
standard response APIs reject safe HTML and stream objects. Validation has no
report-only or disabled mode. Send HTML using `SafeResponse` or `SafeNextResponse`
with `SafeHtml` or `SafeStream`. Test existing handlers before deployment: a response
that previously bypassed validation may now throw.

#### Managed hosting without a controllable Node startup command

Set `NODE_OPTIONS="--import next-xss-sbyd/enforce/preload"` in your provider's build
and Node server environments, and keep the instrumentation hook. Check the provider's
instructions for passing startup options to Node, then run the staging tests below,
including on a newly started server instance. The CLI reads `package.json`; it cannot
verify environment variables set in a shell, Dockerfile, or hosting dashboard. With
only an externally configured option, `check-config` and `audit` still report a
startup-option warning. Verify that configuration in your deployment environment.

If your provider cannot apply this setting, `new NextResponse(body, options)` may
send responses without validation. Replace those calls: use `SafeResponse` or
`SafeNextResponse` for HTML, the global `Response` with an explicit allowed content
type for plain text, and `Response.json()` for JSON. Keep the instrumentation hook
to install validation on the global `Response`. Keep `NextResponse.redirect()`,
`NextResponse.rewrite()`, and `NextResponse.next()` for middleware/proxy control flow:
they have null bodies, which response validation permits. Review response construction in
dependencies too. If you cannot replace the affected calls, deploy to a Node server
where you can set `NODE_OPTIONS`.

#### Verify the deployed behavior

Run `next-xss-sbyd-check-guard .` in CI to check the instrumentation file and the
`package.json` production start script. It passes when either is configured, so a
passing result alone does not verify both required installation steps. `check-config`
and `audit` report a missing startup option as a warning; use `--fail-on-warning`
to make that warning fail CI.

Before deployment, run a staging integration test with the production build and
server configuration:

1. In a Node handler, construct a fixed raw string with `Content-Type: text/html`
   using the global `Response` and the handler's imported `NextResponse`. Confirm
   that each throws the expected `Raw string response` error. Return only the test
   result, and keep this diagnostic handler out of production.
2. Exercise normal requests, error responses, JSON, redirects, and safe HTML. Confirm
   their expected status, body, and content type.
3. Repeat these checks after framework, bundler, or hosting changes.

These tests establish response coverage for the tested build. Instrumentation alone
can pass them on some Next.js versions, so they do not prove the startup option was
applied. Also verify that both build and deployed server commands receive it.

The repository's [fresh-process tests](../tests/issue-197.test.mjs) exercise the
`NextResponse` validation failure when the setting is omitted. Its
[production tests](../scripts/test-compatibility.mjs) exercise response handling in
Next.js applications.

#### Pages Router and custom Node handlers

Wrap Pages Router or custom Node handlers after the framework has installed their
per-request response methods:

```ts
import { htmlEscape } from "next-xss-sbyd";
import { withSafeApiRoute } from "next-xss-sbyd/enforce";

export default withSafeApiRoute((_request, response) => {
  response.safeSend(htmlEscape("<safe text>"));
});
```

The constructor lint rule requires `SafeResponse` or `SafeNextResponse` for
`SafeHtml` and `SafeStream` bodies. `Response` and `NextResponse` remain
the normal choices for explicitly non-HTML output; they do not accept safe objects.
Continue linting because post-construction header mutation and downstream header
changes occur after the constructor has checked the response.

The explicit safe response APIs and `withSafeApiRoute()` set
`Content-Type: text/html; charset=utf-8` and `X-Content-Type-Options: nosniff` for
checked HTML and reject attempts to override either header. Keep using normal
JSON, text, or binary response APIs for non-HTML output.

For a Pages Router API route:

```tsx
import type { NextApiRequest } from "next";
import { withSafeApiRoute, type SafeApiResponse } from "next-xss-sbyd/enforce";
import { safeRenderToString } from "next-xss-sbyd/render";

export default withSafeApiRoute(function handler(
  _req: NextApiRequest,
  res: SafeApiResponse,
) {
  res.status(200).safeSend(safeRenderToString(<main>Safe HTML</main>));
});
```

Do not manually set the HTML content type; `safeSend()` and `safeEnd()` own it.
`SafeApiResponse` is exported from both `next-xss-sbyd` and `next-xss-sbyd/enforce`.
Inline callbacks can omit the annotations. Named handlers and shared HTML-sending helpers
use `SafeApiResponse<NextApiResponse<Data>>` to preserve their JSON body type, or
`SafeApiResponse<YourResponse>` to preserve middleware fields.

All Pages API routes, including JSON-only routes, must export a handler wrapped with
`withSafeApiRoute()`. Composition such as `withAuth(withSafeApiRoute(handler))` is
supported by `require-safe-api-route`. The `no-unsafe-api-send` rule can rename proven
`SafeHtml` calls from `.send(html)` / `.end(html, callback?)` to the safe methods;
review the wrapper and response type annotations as part of that edit. Standard methods
reject all safe HTML/stream objects at runtime, including with a passive content type.
`json()`, redirects, and passive-typed raw strings retain their existing behavior.

`safeSend()` returns `void` and preserves Next's ETag, content-length, conditional-request,
and bodyless-response handling. `safeEnd(html, callback?)` returns the response, forwards
the callback directly to Node, and uses native `end()` semantics without Next's send
processing. It has no encoding overload. Both preserve the selected status code.
Neither method accepts a raw string or a stream; use `safePipe()` for `SafeNodeStream`.
For a custom Node handler, use explicit request/response generics:

```ts
import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import {htmlEscape} from "next-xss-sbyd";
import {withSafeApiRoute} from "next-xss-sbyd/enforce";

createServer(withSafeApiRoute<IncomingMessage, ServerResponse>((_request, response) => {
  response.statusCode = 201;
  response.safeEnd(htmlEscape("<safe text>"));
}));
```

On custom Node responses without `send()`, `safeSend()` falls back to native `end()`.
Do not add `safeSend`/`safeEnd` to unwrapped response types or globally augment Next's
types: the absent methods detect a missing integration before HTML can be emitted.

For Web streaming:

```tsx
import { SafeResponse, trustedScriptUrl } from "next-xss-sbyd";
import { safeRenderToReadableStream } from "next-xss-sbyd/render";

const stream = await safeRenderToReadableStream(
  <html>
    <body>...</body>
  </html>,
  { bootstrapScripts: [trustedScriptUrl`/client.js`] },
);
return new SafeResponse(stream);
```

Do not concatenate, transform, or manually write chunks around these streams: the wrappers
expose no API for editing React's output.
Their safety depends on one React renderer owning the complete parse context.
Bootstrap script and module locations use `TrustedScriptUrl` so only literal,
developer-controlled active-resource URLs reach the renderer.

The explicit safe response APIs are documented in the
[design appendix](design.md#appendix-response-apis).

## 6. Roll out nonce CSP

Next.js 14 and 15 use `middleware.ts`; Next.js 16 uses `proxy.ts` and exports `proxy`.
Start in report-only mode:

```ts
import { createXssSbydHandler } from "next-xss-sbyd/csp";

export const middleware = createXssSbydHandler({
  mode: "report-only",
  reportUri: "/csp-report",
});

export const config = {
  matcher: ["/((?!api/csp-report|_next/static|_next/image|favicon.ico).*)"],
};
```

If middleware already exists, keep xss-sbyd outermost:

```ts
import { withXssSbydHeaders } from "next-xss-sbyd/csp";

async function existingMiddleware(request: NextRequest) {
  return NextResponse.next();
}

export const middleware = withXssSbydHeaders(existingMiddleware, {
  mode: "report-only",
  reportUri: "/csp-report",
});
```

The wrapper preserves redirects, rewrites, cookies, and inner forwarded headers while
owning nonce/CSP control headers. Review reports and add only exact origins through
`scriptSrc`, `styleSrc`, `connectSrc`, `imgSrc`, `fontSrc`, `mediaSrc`,
`frameSrc`, and `formAction`. The builder rejects caller-supplied `unsafe-inline`,
`unsafe-eval`, and `unsafe-hashes`. Development adds `unsafe-eval` for framework
tooling; production does not.

The policy always includes `style-src-attr 'unsafe-inline'`, including when
`styleSrc` adds trusted stylesheet origins. There is no option to deny attributes.
See the [style policy details](csp-styles.md).

A fresh nonce cannot work with cached static HTML. Exclude static pages, Incremental Static
Regeneration (ISR), and Partial Prerendering (PPR) routes
from the matcher, or explicitly make protected routes dynamic. Verify that every
generated executable script has the nonce named in the response CSP. Stylesheet elements inserted
after client navigation must use the nonce accepted by the still-active document,
including when layouts are retained. Nonce-protected documents must be dynamically
rendered. After reviewing reports and passing functional tests
under production enforcement, remove `mode: "report-only"` or set `mode: "enforce"`.

Use the [CSP rollout guide](csp-rollout.md) for the first-party report handler,
report-to-policy CLI, content-reader and embed profiles, explicit tradeoffs, and a
Playwright enforcement-readiness test.

## 7. Isolate exceptional legacy code

Use `next-xss-sbyd/restricted` when a human security expert has determined that
legacy data is XSS-safe, but this package's built-in APIs cannot recognize its
safety. The restricted APIs mark the data as reviewed and create a safe value
accepted by the runtime. For example, after an expert reviews a legacy renderer:

```ts
import { unsafeHtmlDoNotUseOrReviewCarefully } from "next-xss-sbyd/restricted";

const html = unsafeHtmlDoNotUseOrReviewCarefully(
  legacyOutput,
  "Renderer X vY escapes every interpolation; reviewed in SEC-123",
);
```

This function records that a human has reviewed the HTML and determined it to be
XSS-safe. It does not sanitize the HTML.

If an application-specific sanitizer is needed because `sanitizeUserHtml()` does
not retain the required formatting, have a security expert review the sanitizer and
its policy. Keep the sanitizer and restricted call together:

```ts
import { unsafeHtmlDoNotUseOrReviewCarefully } from "next-xss-sbyd/restricted";

export function sanitizeDiagramHtml(input: string) {
  const sanitized = diagramSanitizer.sanitize(input, diagramPolicy);
  return unsafeHtmlDoNotUseOrReviewCarefully(
    sanitized,
    "diagramSanitizer v4 with diagramPolicy; no script, style, URL, SVG, or event-handler output; SEC-247",
  );
}
```

The restricted conversion does not sanitize or validate the policy. Pin and test the
sanitizer and policy, keep the wrapper small, and render its `SafeHtml` with
`SafeBlock`. A lint exemption cannot make a raw HTML prop valid: the JSX runtime still
verifies the `SafeHtml` object and rejects raw strings.

```ts
// eslint-disable-next-line xss-sbyd/no-html-template-strings -- Test-only malicious fixture
const payload = `<p>${untrusted}</p>`;
```

Audit restricted imports and lint exceptions:

```sh
rg 'next-xss-sbyd/restricted|eslint-disable.*xss-sbyd' .
```

## 8. Verify and enforce

1. Migrate or justify every lint finding.
2. Type-check and production-build the application.
3. Exercise HTML handlers, Pages routes, streams, redirects, rewrites, auth middleware,
   and renderer error paths.
4. Test `</script>` breakouts, event handlers, `javascript:` URLs, SVG/MathML,
   form-exfiltration targets, and malformed HTML.
5. Verify exact content types, `nosniff`, CSP headers, and nonce equality.
6. Verify that style attributes apply during first paint, hydration, and client
   navigation. Cover dialogs, themes, toasts, focus/scroll behavior, and accessibility
   announcements on supported browsers.
7. Verify that missing/wrong stylesheet nonces, unauthorized scripts, and inline event
   handlers remain blocked. Investigate remaining framework/library stylesheet reports.
8. Enforce CSP and restore the unmodified recommended preset.
9. Require type-check, ESLint, build, and security integration tests in CI.

Passing TypeScript and ESLint does not establish CSP style compatibility. An empty
console is not a functional test; check first paint as well as hydrated interactions.
Follow the
[production style checklist](csp-styles.md#verify-before-enforcement).

Keep ordinary text in JSX. Sanitize rich HTML before passing it to `SafeBlock` or
an HTML response API. Review restricted imports and keep unsafe APIs disabled.
