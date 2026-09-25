# Checking CSP in Playwright tests

Use `next-xss-sbyd/playwright` to turn existing functional tests into CSP regression
tests. A visible heading can pass a test even when CSP blocks the script that makes
the page interactive. Conversely, a working page can have no enforcing CSP header.
This integration observes browser violations automatically and offers a separate
assertion for the enforcing nonce policy. Keep assertions about application behavior:
absence of violations alone does not establish that the application works or is safe.

## Install and adopt

Install Playwright in the application's development dependencies, then install its
matching browsers:

```sh
npm install --save-dev --save-exact @playwright/test@1.62.1
npx playwright install --with-deps chromium firefox webkit
```

The optional peer range is `>=1.62.1 <2`; pin the runner and browser binaries together
in CI. Version 1.62.1 is the minimum validated runner/browser matrix for this
fixture, not the earliest release containing its APIs. Older runners and their
browser binaries have not been validated; lowering the peer range requires that
compatibility coverage. This entry point is for Node.js tests only. Production imports
do not load or require Playwright.

Change the `test` import in existing tests or their shared fixture module. Continue
importing `expect` from Playwright:

```ts
import {test} from "next-xss-sbyd/playwright";
import {expect} from "@playwright/test";

test("preferences remain interactive", async ({page}) => {
  await page.goto("/preferences");
  await page.getByRole("button", {name: "Dark theme"}).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
```

Set `use.baseURL` in `playwright.config.ts` to the application under test. Observation
starts before the context's first page and observes tabs, ordinary popups (including
those using `window.opener`), `noopener` popups, and same-origin and cross-origin
frames from their initial scripts. Tests fail at teardown
on unexpected enforcing **or report-only** violations even without requesting `csp`.
A report-only violation signals incompatibility; it does not mean execution was blocked.

During a retrofit, adopt this import in representative login, editing, navigation,
dialog, theme, and user-content workflows. Fix the reported script or stylesheet
integration and verify the actual feature still works. Do not make violations pass
by loosening script protections or adding broad expected-violation allowances.
After rollout, retain these checks for dependency and application regressions.

Run against `next build` followed by `next start`, and separately against the actual
staging host or reverse proxy. Development permissions can differ from production;
local success cannot detect a proxy removing headers. Exercise each supported browser.

## First run on an existing suite

Start with a representative production workflow. An `Unexpected CSP violations`
failure includes the browser project, document/frame identity, directive, disposition,
and sanitized location. `enforce` means an enforcing policy reported a violation;
`report` means a report-only policy found an incompatibility. Check the failing
workflow's scripts, styles, requests, and response headers before changing the policy.
Keep the functional assertions: a heading rendering does not prove hydration works.

Open the test result's `csp-observation.json` attachment for the complete event list,
expected sequence numbers, observation errors, and coverage limitations. A document
acknowledgement or initialization error means collection was incomplete; fix the
harness or navigation problem before interpreting a clean event list. Locations
are redacted, so compare their origin and pathname with the failing workflow.

Fix unexpected violations in the application or its integration. Use `expectViolation`
only for a deliberate blocked attack whose exact native event and blocked behavior
you can assert. It is not a suppression mechanism for flaky widgets or known defects.
Test helpers such as `page.addScriptTag()` and `page.addStyleTag()` can themselves
violate CSP; use authorized resources/nonces where appropriate and keep deliberate
unauthorized insertions inside a focused attack expectation.

### Compatibility checklist

- `page.setContent()` and any `document.open()` replace observer listeners and are
  incompatible with the entire fixture. They fail observation at teardown even when
  the test never requests `csp` or asserts a nonce policy. Serve harness HTML over HTTP
  and navigate to it instead.
- `bypassCSP: true` and contexts with precreated pages are rejected. Install the fixture
  before the context's first page; use normal `test.use` context options.
- `browser.newContext()` creates a context outside this fixture's observation. Use
  the supplied `context` and its pages for CSP regression checks.
- `next dev` does not establish production compatibility. Use `next build` / `next start`
  and check the real staging proxy as well.
- All origins are observed, including third-party frames and OAuth popups. Their
  report-only violations fail tests too; there is no origin exclusion option. This
  preserves the all-document contract and avoids silently excluding embedded content.
  For a focused application test, you can block an optional third-party origin with
  Playwright routing, for example
  `await context.route("https://widget.example/**", route => route.abort())` before
  navigation. That test no longer covers the widget or its real integration; keep a
  separate test against the actual provider. Blocking a required payment or login
  provider is not a substitute for testing that workflow.
- Workers and service workers are outside DOM observation. Use independent checks for
  their policies and behavior; a clean fixture result does not certify them.

## Assert the enforcing nonce policy

Add explicit checks to representative protected routes and deployment smoke tests:

```ts
test("preferences enforce the nonce policy", async ({page, csp}) => {
  await page.goto("/preferences");
  await csp.assertNoncePolicy(page, {scriptSelector: "#theme-setup script"});
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await csp.assertNoncePolicy(page, {scriptSelector: "#theme-setup script"});
});
```

Choose an explicit selector for the scripts the application intends to authorize.
For a Next.js page, start with `{scriptSelector: "script"}`: this also checks framework
bootstrap and hydration scripts. Do not use `script[nonce]`, which excludes the very
scripts whose missing nonces you want to detect. `script` also selects inert JSON and
JSON-LD data blocks, which need no nonce for execution; if those are intentionally
unnonced, exclude them explicitly with
`script:not([type="application/json"]):not([type="application/ld+json"])` and review
other script types used by the application. Narrow selectors such as `#theme-setup script`
check only that integration. Nonce-free descendants inserted by a trusted script can
be permitted by `'strict-dynamic'` but will fail an assertion that selects them; choose
the intended nonce-bearing scripts deliberately rather than treating every allowed
script as required to carry a nonce. The example
checks only scripts inside `#theme-setup`; it gives no assurance about omitted
framework scripts. A selection must be nonempty and contain only script elements.
The assertion reads their `.nonce` properties and the captured response that created
the current document, without making a second request.

This checks the package's **strict nonce profile**, not every valid CSP design:

- An actual enforcing `Content-Security-Policy` response header must have an explicit
  `script-src` with one valid, nonempty nonce and `'strict-dynamic'`, without
  `'unsafe-inline'`, `'unsafe-eval'`, or `'wasm-unsafe-eval'`.
- That policy must use `object-src 'none'` and `base-uri 'self'` or `'none'`.
  A `script-src-elem` override must use the same single nonce and `'strict-dynamic'`
  without those unsafe keywords; `script-src-attr`, if present, must be `'none'`.
  Legacy handler policies using `'unsafe-hashes'` and hashes are rejected: this
  profile disallows inline event handlers, even when another CSP design authorizes them.
- Every selected script must have the policy nonce. Every additional enforcing
  policy must permit those scripts through that same nonce. Hash-only or URL-only
  authorization in another policy is outside this assertion's supported profile.

Report-only headers and HTML meta policies alone fail. So do pages outside the
fixture's context and documents without reliable response evidence.
The assertion does not certify all directives, sanitization, or freedom from XSS.

The reload above must receive a fresh nonce. Successful assertions in different
documents within one test reject nonce reuse, including reloading the same URL.
Assertions after a Next.js link navigation that retains the document require its
original nonce. Follow the link, check the resulting screen, and assert again; the
fixture tracks document identity independently of URLs. These checks neither prove
nonce unpredictability nor compare nonces across tests. The nonce check validates
syntax and a nonempty value, not a minimum length or entropy. Length alone cannot
prove randomness: use the package nonce generator or an independently reviewed
cryptographic generator, and never use a static nonce.

## Test a deliberate blocked attack

Keep deliberate attacks in focused tests. Declare the exact browser event and also
prove that the attempted behavior did not happen. Create a fresh inline handler
inside the expectation's action and attempt to invoke it with a real click:

```ts
test("an unauthorized inline handler cannot execute", async ({page, csp}) => {
  await page.goto("/preferences");
  await csp.assertNoncePolicy(page, {scriptSelector: "#theme-setup script"});

  await csp.expectViolation(
    {
      frame: page.mainFrame(),
      effectiveDirective: "script-src-attr",
      disposition: "enforce",
      blockedURI: "inline",
      count: 1,
    },
    async () => {
      await page.evaluate(() => {
        document.querySelector("#attack")?.remove();
        document.documentElement.removeAttribute("data-attack-ran");
        const button = document.createElement("button");
        button.id = "attack";
        button.textContent = "Attempt inline handler";
        button.setAttribute("onclick", "document.documentElement.dataset.attackRan = 'yes'");
        document.body.append(button);
      });
      await page.locator("#attack").click();
    },
    async () => {
      await expect(page.locator("html")).not.toHaveAttribute("data-attack-ran", "yes");
    },
  );
});
```

The inline handler is the operation under test; `page.evaluate` only constructs its
button. Creating it during the action keeps browsers that report at handler installation
inside the expectation's interval. Use a fresh handler for each attempt: clicking
an already rejected handler again need not emit another event.
Do not run the attack code itself directly from `page.evaluate`: browser automation
evaluation can bypass CSP for that operation.
Scripts inserted by an authorized script can also inherit trust under `'strict-dynamic'`.
The final `assertBlocked` callback is **your responsibility**: include a meaningful
behavior assertion. This marker covers synchronous execution. For an asynchronous
attack, wait for the relevant attempt to finish before asserting its outcome.
If another protection prevents insertion before CSP sees it, use a dedicated CSP
test page and test that earlier protection separately.

Expectations match exactly by current document, frame, directive, disposition,
blocked URI, optional `sourceURL`, and positive integer `count`. Use sanitized URLs
as described below. There are no patterns or blanket allowlists. Establish counts
for each supported browser explicitly when native event counts differ. Navigate
before calling the method: replacing the document during a call fails. Nested or
simultaneous calls in one test also fail.

Earlier violations remain unexpected. A successful call acknowledges only the exact
records in its interval after both callbacks and collection succeed. Missing or extra
events, unrelated violations, callback failures, and later duplicates fail. A
`disposition: "report"` expectation requires independent proof that another protection
blocked the behavior; report-only CSP cannot supply that proof.

## Combine application fixtures

Extend the exported test with ordinary application fixtures, or merge independent
fixtures that do not replace `context` or `page`:

```ts
// fixtures.ts
import {test as cspTest} from "next-xss-sbyd/playwright";
import {mergeTests, test as base} from "@playwright/test";

const accountTest = base.extend<{accountName: string}>({
  accountName: "CSP test account",
});

export const test = mergeTests(cspTest, accountTest);
// Alternatively: export const test = cspTest.extend({accountName: "CSP test account"});
```

Configure normal context options with `test.use`. Do not override `context` or
`page`: an already populated context is rejected because initial violations may
have been missed. `bypassCSP: true` is rejected. Contexts created separately with
`browser.newContext()` are outside this fixture.

## Collection and diagnostics

`csp.violations()` returns a frozen snapshot of all received records, including
expected ones; reading it does not acknowledge them. Records survive full navigation
and page closure once received. Page and frame IDs are stable, document IDs change
on full navigation, and `sequence` is arrival order within the test, starting at 1.

Use `await csp.flush()` before deliberately closing a page or fully navigating when
the preceding interaction needs a collection checkpoint. It waits for live-document
readiness, queued-event acknowledgement, and a quiet interval without received CSP
events; it does not acknowledge violations. Each pass checks the currently live
documents. Adding or removing clean frames does not restart that interval, so widgets
that continuously remount frames can finish collection. A newly attached frame is
not promised its own full quiet interval, and future events remain outside the check. Defaults are 100 ms quiet time and a 2,000 ms collection timeout:

```ts
test.use({cspObservation: {quietMs: 200, timeoutMs: 3_000, associationTimeoutMs: 30_000}});
```

All three values must be positive finite integers, with `quietMs < timeoutMs`.
`associationTimeoutMs` separately bounds response-to-document association, including
streaming document readiness, and defaults to 30,000 ms. Increase it for deliberately
slow streaming routes; increasing the quiet collection timeout is not necessary for
that purpose. `timeoutMs` also bounds waiting for an expected violation.
The automatic fixture has a 60,000 ms setup/teardown timeout; choose observation
budgets that leave room for collection and attachment within that bound. Action and
behavior callbacks remain subject to Playwright's overall test timeout. Missing
initialization, failed acknowledgements, observed sequence gaps, page crashes, and
collection timeouts fail observation. Teardown collects and reports failures even
when the test body has already failed.

### Popups and frames

Ordinary popups and `noopener` popups are checked on their first page load; no extra
navigation or change to the application's opening behavior is needed. Initial
same-origin and cross-origin frame violations are collected as well. Browser tests
verify that the initial unauthorized script is blocked, its violation is recorded
exactly once, and clean opening flows pass in Chromium, Firefox, and WebKit.

`assertNoncePolicy` also checks the popup's first HTTP response. The fixture waits
for Playwright to associate that response with its frame, then matches the exact
request and document. It does not guess from URLs: simultaneous popups at the same
URL can have different nonces. Tests cover those popups, redirects, reloads, and
HTTP error responses.

### Artifacts and remaining coverage limits

Each result includes `csp-observation.json` with browser/project identity, sanitized
records, expected sequence numbers, observation errors, and coverage limitations.
HTTP(S) URLs retain origin and pathname but lose credentials, query strings, and
fragments. `inline` and `eval` remain tokens; other schemes, including `data:` and
`blob:`, retain only the scheme. Records and attachments omit nonces, raw policies,
HTML, referrers, and script samples. Pathnames can still contain sensitive data;
apply normal artifact access and retention controls. This fixture cannot redact
Playwright traces or application logs it does not create.

CSP events are asynchronous. A document that closes or replaces itself immediately
can disappear before an event is observable. A successful flush bounds the observed
interval; it does not promise no later events. Add a controlled pause or independent
header and blocked-behavior checks for such flows. Events during final context closure
are outside the completed check. Workers, service workers, browser-internal pages,
and documents where initialization cannot be installed are outside DOM observation;
a detected unsupported document fails observation. This is a browser regression aid,
not an XSS scanner or protection against hostile code tampering with its observer.
