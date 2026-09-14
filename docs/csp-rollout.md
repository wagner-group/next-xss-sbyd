# Rolling out Content Security Policy

Roll out the nonce CSP in three stages: collect reports, review the policy changes
the application needs, and verify enforcement through the production host or proxy.
Report-only mode helps identify compatibility problems before enforcement; it does
not block attacks.

## 1. Receive reports safely

Use `createCspReportHandler` to validate incoming reports before logging them.
Create a Route Handler at `app/api/csp-report/route.ts`:

```ts
import {createCspReportHandler} from "next-xss-sbyd/csp";
import {withSafeRouteHandler} from "next-xss-sbyd/route-handler";

export const POST = withSafeRouteHandler(createCspReportHandler({
  log(report) {
    console.warn(JSON.stringify(report));
  },
}));
```

For `application/csp-report`, the handler accepts either the legacy
`{"csp-report": body}` wrapper object or a single explicitly typed
`{type: "csp-violation", url, body}` report, as observed from WebKit 26.5.
`application/reports+json` requires a standard Reporting API array; it does not
accept a single report object outside an array. The receiver routes the WebKit envelope through the same
validation and limits as other reports. It enforces a 64 KiB request limit by default,
normalizes blocked HTTP(S) URLs to origins, removes control characters from samples,
limits samples to 256 characters, deduplicates each batch, accepts at most 32 distinct
reports per request, and never reflects report content in its response. Set `maxBytes`
or `maxReports` to a smaller positive integer if appropriate. A malformed entry rejects
the whole request instead of silently discarding reports.

Samples have whitespace/control runs normalized and are truncated to 256 characters
by this receiver. Native browser samples generally expose only the first 40 characters
and require `'report-sample'`, which the builder does not emit by default. They are
diagnostic hints, not exact CSS bytes. A `securitypolicyviolation` event may target
`Document` and lack useful element attribution. Neither reports nor events reliably
identify a component or contain its complete offending stylesheet.

The `log` callback receives report data that an attacker can also submit. Store it as structured data;
do not interpolate it into HTML, shell commands, SQL, or unescaped log formats. Reports
can contain page URLs and code samples, so apply the application's retention and access
policy for potentially sensitive data. Put request-rate controls at the reverse proxy or
hosting layer: the body limit bounds one request, not the number of requests. A callback
failure rejects the request so a failed write is not silently reported as successful.

Configure report-only middleware and exclude the receiver itself:

```ts
import {createXssSbydHandler} from "next-xss-sbyd/csp";

export const middleware = createXssSbydHandler({
  mode: "report-only",
  reportUri: "/api/csp-report",
  reportTo: "/api/csp-report",
});

export const config = {
  matcher: ["/((?!api/csp-report|_next/static|_next/image|favicon.ico).*)"],
};
```

Use `proxy` instead of `middleware` on Next.js 16. Keep the endpoint same-origin and do
not require a CSP nonce, CSRF token, or interactive session: browsers must be able to
submit a violation caused before application code runs. `reportUri` supports legacy CSP
delivery; `reportTo` adds the `report-to xss-sbyd` directive and same-origin
`Reporting-Endpoints` header needed for Reporting API batches. Configure both while
supporting browsers that use either mechanism. The endpoint accepts only POST and the
two CSP report media types.

Validate Reporting API delivery on **HTTPS** staging. With `mode: "report-only"`
and `reportUri`, the builder also emits `report-to` and `Reporting-Endpoints` for
that receiver. Chromium can select Reporting API delivery instead of the legacy
`report-uri` path. In the local HTTP production run, report-only POSTs were not
observed. The fixture therefore checks Chromium report-only events and their disposition
separately; it does not promise Chromium report-only POST delivery. Enforcing
`report-uri` checks in both engines, and WebKit report-only checks, wait for real
POST responses with status 204.
The [Reporting API draft](https://w3c.github.io/reporting/#header-processing) requires
potentially trustworthy endpoints and describes delivery as best effort, so even a
secure endpoint is not a guarantee that every browser event produces a POST.

### Threats to the rollout process

The endpoint is intentionally unauthenticated, so an Internet client can fabricate
reports and try to influence the reviewed policy. Retain occurrence counts, first/last
timestamps, request metadata such as `Sec-Fetch-Site`, and the normalized document URL
when your storage model permits it. Confirm that document URLs belong to an expected
application origin, but do not treat request headers as authentication because a direct
client can forge them. Escape newlines before writing any retained value to a
line-oriented log. Rate-limit at the edge, and never approve a source merely because it
appears frequently in telemetry.

<a id="2-turn-reports-into-a-reviewed-policy-delta"></a>

## 2. Review suggested policy changes

Persist normalized callback values as either a JSON array or one JSON object per line,
then run:

```sh
next-xss-sbyd-csp-suggest reports.jsonl
```

With no filename, the command reads standard input. It prints a JSON
`Partial<XssSbydCspOptions>` value to standard output and review warnings to standard
error. It deduplicates and sorts exact HTTP(S) origins. It does not automatically add
wildcards, broad `http:` or `https:` schemes, inline/eval allowances, or `data:`/`blob:`
to active directives. `data:` and `blob:` are suggested only for `img-src` and
`media-src`, where their risk is narrower but still needs review. Suggested arrays are
complete option values and retain each directive's default source, such as `'self'`.
Script host violations produce a warning to check that the nonce reaches every intended script
element because `'strict-dynamic'`
ignores host allowlists. `form-action`, `frame-src`, and unsupported directives always
require manual investigation and are never automatically added.

Treat the output as evidence, not an authorization decision. Confirm that each origin is
owned or intentionally trusted, remove stale and extension-generated noise, and add only
the entries the application needs. Do not add `'unsafe-inline'` to script or stylesheet
source lists in response to an inline violation. Identify the sink before choosing a remedy:

- Ordinary `style` attributes are allowed by the default
  `style-src-attr 'unsafe-inline'` and need no migration. An attribute violation can
  indicate an additional or outdated policy at the application, proxy, or CDN, a cached
  response, or a previous deployment’s report-only policy during rollout.
- For a small fixed stylesheet element, use `SafeStyleBlock` with literal-only
  `safeStyleSheet` and the nonce accepted by the current document. Fix missing nonce
  propagation for trusted stylesheet elements; never interpolate untrusted CSS text.
- For script elements, prefer bundled code or the existing safe script APIs and correct
  nonce propagation. Retain all script protections while investigating style reports.
- For framework/library stylesheet elements, follow the
  [dependency integration guide](csp-style-integrations.md) and verify behavior in
  supported production combinations.

Report samples are not authorizations; this workflow does not generate hashes or
relax the policy automatically. The builder's attribute allowance remains in effect
when `styleSrc` adds a stylesheet origin. See the [style policy details](csp-styles.md).

## 3. Select an application policy profile

These profiles are starting points. Keep the nonce requirement for initial script elements in every profile.

### Self-hosted application

Start from defaults and use report-only telemetry from every supported deployment.
Self-hosters commonly configure object storage, image proxies, fonts, or API endpoints.
Add those deployment-specific exact origins through environment-derived options rather
than committing one vendor's origin as a universal default.

### Content reader or bookmark manager

Arbitrary saved pages can make an exact image/media host list impractical. A deliberate
passive-content profile can use:

```ts
createXssSbydHandler({
  imgSrc: ["'self'", "https:", "data:", "blob:"],
  mediaSrc: ["'self'", "https:", "blob:"],
});
```

This permits cross-origin tracking pixels and resource fetches to arbitrary HTTPS hosts;
`data:` and `blob:` also broaden what can be rendered. Proxying and validating remote
media is stronger when feasible. Do not copy these schemes into `scriptSrc`, `styleSrc`,
or `frameSrc`: initial executable script elements still need the nonce and frames remain denied unless
explicitly allowed.

### Fixed-origin embeds

List each reviewed provider explicitly:

```ts
createXssSbydHandler({
  frameSrc: ["https://player.example.com", "https://social.example.com"],
});
```

CSP controls where a frame loads from, not what privileges it receives. Pair it with the
narrowest functional iframe `sandbox` value, an explicit `allow` policy, and a validated
source URL. Avoid combining `allow-scripts` and `allow-same-origin` for same-origin framed
content because that can effectively defeat sandboxing.

## 4. Prove enforcement readiness

Run a production build in staging (`next build`, then `next start`), deliberately
selecting enforcement or report-only mode. `next dev` has different rendering/tooling
behavior and an internal eval allowance, so it cannot validate the deployed policy.
Run this initial-response Playwright check against that deployment. Adapt the URL and
any intentionally unprotected routes:

```ts
import {expect, test} from "@playwright/test";

test("production responses enforce the nonce CSP", async ({page}) => {
  const response = await page.goto("/account");
  expect(response).not.toBeNull();

  const headers = response!.headers();
  expect(headers["content-security-policy-report-only"]).toBeUndefined();
  const policy = headers["content-security-policy"];
  expect(policy).toBeTruthy();

  const nonce = /(?:^|;)\s*script-src[^;]*'nonce-([^']+)'/.exec(policy!)?.[1];
  expect(nonce).toBeTruthy();

  const html = await response!.text();
  const scriptNonces = [...html.matchAll(/<script\b[^>]*>/giu)]
    .map(([tag]) => /\bnonce=["']([^"']+)["']/iu.exec(tag)?.[1]);
  expect(scriptNonces.length).toBeGreaterThan(0);
  expect(scriptNonces.every((value) => value === nonce)).toBe(true);
});
```

Set `use.baseURL` in `playwright.config.ts`, or replace `"/account"` with an absolute
deployed URL. The assertion inspects server HTML rather than the live DOM because a
nonce-trusted script may legitimately insert nonce-free descendants under
`'strict-dynamic'`.

This checks only the initial response. Also verify stylesheet loading, first paint,
hydration, and later style insertion. Continue after hydration: navigate
with `<Link>`, reopen dialogs, change selection/tab/switch, toggle themes, and show and
dismiss toasts. Measure image placement, hidden labels, focus restoration, scroll
locking, and computed styling. Wait for observable UI state and report delivery;
checking the console immediately after a click misses asynchronous failures. Install
a test-side listener with `page.addInitScript` before application scripts. The
[production dependency recipes](csp-style-integrations.md) describe the fixture,
version pins, and review of stylesheet elements inserted by Radix, next-themes, and
Sonner. A broken layout or accessibility behavior cannot be classified as benign to
pass a test.

Before switching to `mode: "enforce"`, verify all of the following:

- representative authenticated, unauthenticated, error, redirect, and user-content paths
  have been exercised in report-only mode;
- expected production integrations are covered and unexplained violations are resolved;
- the browser-visible response has `Content-Security-Policy`, not only
  `Content-Security-Policy-Report-Only`;
- every executable script has the nonce from that same response's policy;
- application and dependency style attributes apply in initial server HTML, and
  stylesheet delivery uses the permitted origin or document nonce;
- production checks assert first-paint layout, hydration, client navigation, dialogs,
  themes, toasts, focus/scroll behavior, and accessibility announcements; check computed
  styles and dimensions, not only console output;
- stylesheet elements inserted after navigation use the nonce accepted by the active
  document, including retained layouts; missing/wrong stylesheet nonces, unauthorized
  scripts, and inline event handlers are still blocked;
- the CDN, reverse proxy, platform configuration, and inner middleware do not overwrite
  the enforcing header;
- static pages, Incremental Static Regeneration (ISR), and Partial Prerendering (PPR) pages are excluded or made dynamic, because a per-request nonce
  cannot be reused safely from cached HTML; and
- monitoring continues after enforcement so regressions and deployment-specific origins
  remain visible.

Use the [style verification checklist](csp-styles.md#verify-before-enforcement) to record
tested Next.js/browser versions, unavailable coverage, and residual compatibility
decisions. An accessibility failure cannot be dismissed as a benign CSP report.
