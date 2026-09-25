# Caveats and residual risks

`next-xss-sbyd` is intended to eliminate accidental **server-side XSS** in supported
TypeScript Next.js applications. It is not a proof that an application is free of
XSS. Its guarantees depend on developers using the supported APIs, running the
recommended ESLint preset over all relevant code, and deploying an effective CSP.

The project assumes well-intentioned but fallible developers. The following risks
remain outside its scope and require ordinary security review and testing.

## Deliberate or structural bypasses

A developer who intends to subvert the system can do so: remove or weaken the ESLint
preset, exclude a file, disable a rule, cast a value to bypass type checks, call an
unsafe platform API from unusual code, alter generated output, fork the runtime, or
replace a dependency. The type and lint layers are guardrails for mistakes, not a
security boundary against someone who controls the source, build, configuration, or
deployment.

Likewise, the rules do not perform whole-program analysis. Reflection, dynamically
selected properties, metaprogramming, custom renderers, code generation, unusual
wrappers, deliberately misleading types, and novel framework integrations can fall
outside the patterns the plugin recognizes. Prefer conventional, typed code. Treat
security-sensitive abstractions that hide HTML, URL, response, or rendering operations
as separately reviewed sinks.

## Client-side and DOM-based XSS

This package checks server-produced markup and HTTP response bodies. It does
not prevent client-side JavaScript from passing attacker-controlled data to DOM sinks
such as `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, string-taking
timers, `eval`, or script-creating APIs. It also does not analyze client-side URL,
CSS, template, postMessage, or hydration data flows.

Audit browser code with client-side security tooling and tests. Keep untrusted data in
text and attribute APIs, validate message origins, and avoid DOM sinks that parse
strings. CSP can limit some exploit paths, but a policy that authorizes the executing
client script does not make that script's DOM operations safe.

The optional [checked object-URL API](object-url.md) supports browser PNG/JPEG/GIF
previews and downloads with explicit ownership and revocation. MIME labels do not
validate bytes, and downloaded files can be unsafe when opened externally. This
capability does not make ordinary `blob:` strings valid URL inputs or permit active
resource embedding.

## JSX is conditional, not automatically safe

This package's validating JSX runtime checks HTML attributes as needed to prevent
XSS. It checks built-in HTML/SVG elements such as `<a>`, called intrinsic elements.
Custom components are blocks defined by the application.

This package also provides replacements for Next.js `Link`, `Image`, and `Form`
through `next-xss-sbyd/compat/link`, `next-xss-sbyd/compat/image`, and
`next-xss-sbyd/compat/form`. They check the `href`, `src`, and `action` values,
respectively, and reject raw HTML in `dangerouslySetInnerHTML` or `srcDoc`.

Ordinary React interpolation is the safe default: React escapes strings used as JSX
text and normal attribute values. That protection does not extend to every operation
expressible in or around JSX:

- `dangerouslySetInnerHTML`, inline script/style bodies, active URL attributes,
  `iframe srcDoc`, SVG attributes, and object spreads have context-specific risks.
- A custom component can reinterpret an apparently harmless prop, forward it to an
  HTML or script operation, or manipulate it on the client. The JSX runtime checks
  HTML attributes on built-in elements. It cannot inspect the implementation of a
  custom component. Review components that insert HTML or construct URLs.
- Custom elements, uncommon SVG/MathML features, new React or Next.js behavior, and
  unusual prop construction may not be covered by the current rules.
- Hydration and effects can transform safe server output into unsafe DOM operations.
- Escaping prevents markup injection; it does not make attacker-chosen content,
  destinations, CSS, or application behavior trustworthy.

Do not infer “written as JSX” to mean “safe.” Keep the recommended preset enabled,
avoid unusual sink wrappers, and test the rendered browser behavior of exceptional
markup.

### Active sinks without direct TypeScript JSX support

React types active intrinsic URL props as strings, which cannot carry a
`TrustedScriptUrl` directly. `SafeExternalIframe` is the supported iframe adapter and also
requires a fixed hardened sandbox. Other active sinks remain deliberately narrower:

- Prefer bundled scripts. `SafeScriptBlock` covers only reviewed
  literal inline code, not a dynamic `script[src]`.
- Next.js normally owns stylesheet links. Other executable `link[href]` values need a
  reviewed exception.
- `embed` and `object` are unsupported and blocked by the fixed `object-src 'none'`
  policy.
- Active SVG `use`/`image` references have no typed JSX carrier and need a reviewed
  exception or a different representation.

Do not cast a safe value to `string` merely to satisfy an intrinsic prop type. Such a
cast hides the type mismatch and defeats the lint rule's ability to verify the value.

### Native PDF viewing

`SafeExternalIframe`'s sandbox profiles are intended for HTML documents. Chrome can show a
broken-document frame for native PDFs under either `sandbox=""` or
`sandbox="allow-scripts"`, without a console or page error. HTTP 200, an
`application/pdf` response, and the presence of an iframe do not prove that the PDF
is viewable. Adding script permissions does not fix this native-viewer limitation.

When inline viewing is unnecessary, use an ordinary link to open or download the
PDF from a controlled endpoint. Serve actual PDF bytes with
`Content-Type: application/pdf` and `X-Content-Type-Options: nosniff`. For a download,
serve `Content-Disposition: attachment`; for opening in the native viewer, use
`Content-Disposition: inline`. Review redirects, authentication failures, and error
responses so they cannot unexpectedly serve active HTML. A link opens a top-level
page without the iframe sandbox; same-origin HTML then has the application's origin
privileges. The endpoint, redirects and error responses must never expose untrusted
active HTML on that origin; prefer a dedicated origin for user-supplied documents. A trusted URL does
not validate response bytes.

```tsx
<a href={`/documents/${encodeURIComponent(documentId)}.pdf`}>Open PDF</a>
```

The JSX runtime validates this navigation URL; it does not need a
`TrustedScriptUrl`. The endpoint must still meet the response requirements above.

Keep `SafeExternalIframe`'s HTML policy unchanged. Do not add `allow-same-origin` to work
around PDF failures, or use `embed`/`object`, which conflict with `object-src 'none'`.
If inline PDFs are required, treat the integration as a separately reviewed
application requirement; this package provides no PDF component or general inline
PDF recipe. An iframe without a sandbox loses `SafeExternalIframe`'s protection across
arbitrary frame navigations.

The [native PDF browser fixture](../scripts/test-native-pdf.mjs) checks an unsandboxed
one-page viewer control and both supported `SafeExternalIframe` sandbox profiles. These
browser diagnostics document the current limitation, not an inline-PDF recipe.

## Third-party components and dependencies

The ESLint plugin checks application source, not the internals of installed React
components. The `withXssSbyd` Next.js configuration wrapper adds runtime checks to
bundled imports of `react/jsx-runtime` and `react/jsx-dev-runtime` by default,
including precompiled dependencies. This requires webpack and excludes Next.js
internals and this package's own implementation. It does not intercept
`React.createElement`, later prop changes through `React.cloneElement` (including
some `asChild` composition), server dependencies left external to the bundle,
vendored JSX runtimes, or direct DOM operations. Redirecting a library's JSX import
does not establish that its final HTML element passes through the checks.

In Pages Router, Next.js normally loads server dependencies directly from
`node_modules`, outside webpack. With this default configuration, redirection reaches
server-rendered dependency JSX only for packages included in `transpilePackages`;
the wrapper does not add your
third-party libraries to that list automatically. Client-side checks cannot undo an
injection already emitted in the server response: an injected script may run before
hydration, and a later client-side rejection can also break hydration.

To include a JSX-bearing dependency in Pages server checks, add its package name to
your existing configuration before wrapping it, and test its normal and hostile-input
rendering in production and development:

```js
export default withXssSbyd({
  // Preserve existing entries; include JSX-bearing transitive packages as needed.
  transpilePackages: ["your-component-library"],
});
```

This is a partial mitigation, not a guarantee about all output from that library.
App Router bundles dependencies by default, but explicitly externalized packages
remain outside these checks. The integration tests pin both the checked, transpiled
Pages dependencies and the unchecked default ESM/CommonJS dependency behavior.

The runtime omits an exactly empty `img src` rather than rejecting it, accommodating
libraries such as React Markdown that represent rejected image URLs as empty strings.
Whitespace-only or unsafe nonempty URLs and empty active-resource URLs still throw.

Turbopack is unsupported for JSX import redirection. Selecting
`withXssSbyd(config, {redirectJsxRuntime: false})` explicitly disables it; application
`jsxImportSource` and the separate Next.js component aliases retain their own checks.
Redirection can expose incompatible raw-HTML and URL uses in dependencies. Test
ordinary rendering as well as hostile input when enabling it or upgrading packages.
The redirection tests cover Next.js 14–16 webpack production and development builds,
App and Pages routers, server rendering, hydration and client updates. Edge routes
are tested on Next.js 14/15. Next.js 16 Edge coverage is not established: the fixture
currently encounters a missing client-reference manifest during its build.

A third-party component can use `dangerouslySetInnerHTML`, construct an unsafe URL,
emit an inline script, or perform a DOM-based injection after hydration. A component's
typed props are not proof of safe implementation. Review security-sensitive
components, pin and update dependencies deliberately, and test them with hostile
inputs. Prefer libraries that accept structured React nodes over raw markup strings.

The same limitation applies to React, Next.js, SafeValues, DOMPurify/jsdom, the
TypeScript/ESLint toolchain, and other transitive dependencies. Defects or incompatible
version changes in those components can invalidate assumptions. Compatibility tests
reduce this risk but cannot eliminate supply-chain compromise or unknown defects.

## Escape hatches and exemptions

Use `next-xss-sbyd/restricted` when a human security expert has reviewed how data is
produced and used and determined it to be XSS-safe, but this package's built-in APIs
cannot recognize it as safe. For example, an application may use its own sanitizer.
These APIs mark the data as reviewed and safe and return a safe type accepted by this
package's runtime. The safe type records that a human has reviewed the data and
determined it to be safe. The APIs do not sanitize or validate the string themselves.

Record why the usage is safe in the required justification. ESLint disable comments
are another escape hatch. A description proves only that someone supplied text, not
that the exemption is sound.

This quick search is useful, but it is not a complete audit:

```sh
rg 'next-xss-sbyd/restricted|eslint-disable.*xss-sbyd' .
```

By default, ripgrep skips hidden, ignored, and binary files. The search also does not
find rules disabled or downgraded in ESLint configuration, files excluded from lint,
CI commands that lint only part of the application, other operational gaps, or a
preset that was never loaded. Generated files are
intentionally ignored by the recommended preset and need separate review if they can
produce server output.

Use all of the following during a security review:

1. Search source escape hatches, including hidden and ignored source, while excluding
   dependency and VCS storage:

   ```sh
   rg --hidden --no-ignore -n \
     -g '!node_modules/**' -g '!.git/**' \
     'next-xss-sbyd/restricted|eslint-disable.*xss-sbyd' .
   ```

2. Read every ESLint configuration file in full. Look for `xss-sbyd/` severities set
   to `off` or `warn`, later overrides of the recommended preset, `files`/`ignores`
   patterns, alternative plugin aliases, and dynamically constructed configuration.
   Also review `package.json`, CI workflows, and lint scripts to confirm ESLint covers
   all application JavaScript and TypeScript.
3. Run ESLint normally so unused, malformed, or unjustified disables are reported,
   then run the same scope with `--no-inline-config` to reveal findings hidden by
   inline comments. Use `eslint --print-config path/to/representative.tsx` for each
   important file class to verify that every xss-sbyd rule has the intended severity.
4. Manually review each restricted conversion and disable. Confirm the data's origin,
   the exact sink and parser context, the sanitizer or construction algorithm, pinned
   versions and policy, adversarial tests, the review reference, and whether the
   exception can be removed.

Search results are an inventory, not approval. Configuration and effective lint
coverage are part of the security boundary.

## CSP configuration and deployment

CSP is effective only when it is enforced and reaches the browser unchanged. Passing
`mode: "report-only"` records violations but provides no protection. Broad additions
to `scriptSrc`, `styleSrc`, `frameSrc`, or other source lists can authorize origins or
content that an attacker can influence. The source validator prevents directive
injection; it does not decide whether a syntactically valid source is trustworthy.

Other integration errors include omitting a route from the middleware/proxy matcher,
placing `withXssSbydHeaders` inside another wrapper, failing to make nonce-protected
pages dynamic, serving cached HTML with a stale nonce, adding a second conflicting CSP
at a proxy or CDN, overwriting the header downstream, and running production with
development settings. Static documents, Incremental Static Regeneration (ISR), and Partial
Prerendering (PPR) cannot receive a fresh matching
nonce per request.

Verify the deployed response, not just the source configuration: enforcement mode is
active; every intended route has the policy; script nonces match; no intermediary
weakens or replaces headers; and violation reports are monitored. The fixed
`style-src-attr 'unsafe-inline'` permits ordinary style attributes; stylesheet elements
are nonce-restricted in browsers supporting `style-src-elem`. Older browsers use
`style-src 'self' 'unsafe-inline'`: attributes and inline stylesheets apply even without
a nonce. Script restrictions remain unchanged. Avoid additional inline/eval allowances,
wildcards, overly broad schemes, and attacker-writable trusted origins.
CSP is defense in depth and does not repair unsafe HTML or DOM code.

CSP violation reports are unauthenticated, attacker-controlled, lossy telemetry. They
can contain sensitive page URLs, source locations, policy text, and samples, and forged
reports can attempt to poison an allowlist decision. Apply retention and access controls,
rate-limit the receiver, preserve enough metadata and counts to investigate provenance,
escape line-oriented logs, and treat `next-xss-sbyd-csp-suggest` output only as a proposed
delta requiring human authorization. Missing reports do not prove that delivery works;
verify both legacy `report-uri` and Reporting API configuration end to end.

## Sanitization and trusted content decisions

The built-in browser/Node sanitizer applies one fixed policy, including images and
native audio/video. It does not support SVG, MathML, templates, executable embeds,
custom elements, or application-specific active content. Edge and workers without a
DOM are unsupported. Retest hostile input after parser/engine upgrades. Never mutate
or concatenate serialized output after sanitization. The narrowly reviewed text-node
highlight recipe in [the API guide](sanitize.md) is not general permission to modify
clean DOM. Imported markup must not become an application command or authorize a saved
record operation. Sanitization does not establish truthful content or trustworthy links.

Sanitized HTML can load images, posters, and media from HTTP(S) origins allowed by the
application's browser policy. Privacy-sensitive applications should restrict CSP
`img-src`/`media-src` or use a reviewed proxy. Image requests can reveal IP addresses and
reading time; cookies depend on browser rules. Image `referrerpolicy="no-referrer"`
does not hide IP addresses or suppress every credential behavior. Media referrers also
depend on document policy. Removing autoplay and setting `preload="none"` does not
establish consent to every request; preload is a browser hint.

Allow only intended image/media destinations in CSP and keep script restrictions
strict. Never automatically weaken CSP to restore an image. A proxy requires separate
review of server requests and uploads. Validating URLs does not validate downloaded
bytes or protect against media-decoder vulnerabilities. Same-site resource endpoints
must avoid state-changing GET operations. The host document must not use an external
`base` that changes the origin of root-relative resources; enforce a restrictive
`base-uri` policy (the library default is `'self'`, which blocks external bases).

Trusted Types lets an application require sanitization before passing data to
dangerous sinks such as `innerHTML`. The application supplies the sanitization policy.
Applications enforcing Trusted Types must allow DOMPurify's `dompurify` policy name
in `trusted-types` (or `dompurify#<suffix>` with `data-tt-policy-suffix`). Otherwise
the browser sanitizer throws an engine-failure error. The library CSP builder emits
no Trusted Types directives; its defaults are unaffected. See the [API guide](sanitize.md).

Parsing hostile input can attempt requests or generate CSP reports before removal,
including in detached documents. There is no promise of no network activity while
sanitizing. Record parser-time requests/reports separately from final displayed-content
behavior; do not silence all CSP reports. Applications requiring no contact with
imported hosts need import/isolation controls established before parsing.

Data URLs, blob URLs, document-relative resources, internal fragment links, styles,
and annotation data attributes are intentionally unsupported. Resolve imported relative
URLs against the original article URL before final sanitization. Saved inline images
need reviewed serving/upload code or a separately reviewed custom sanitizer. The
[API guide](sanitize.md) explains the remaining fidelity and transport limits.

The URL functions `navigationUrl`, `resourceUrl`, and `formActionUrl` reject dangerous
URLs such as `javascript:` URLs. Each returns a different safe type to record that the
URL passed the checks for navigation, resource loading, or form submission. These
TypeScript types are called brands. They prevent accidentally using an unchecked URL
where an API requires a checked one. The JSX runtime also validates URL strings at
runtime. These checks do not prevent phishing, open redirects, privacy leaks, unwanted
navigation, server-side request forgery, or authorization bugs.

For scripts and frames, `trustedScriptUrl` creates a runtime-checked object that
identifies a developer-controlled URL. Developers must review the referenced content.
Similarly, `safeScript` and `safeStyleSheet` mark literal JavaScript and CSS as safe
after developer review. These APIs cannot establish that the code is benign.
Compromise of an authorized origin or a mistake in reviewed code remains exploitable.

`trustedScriptUrl` percent-encodes interpolations, but literal URL syntax still
needs review: under HTTP(S), browsers treat backslashes as slashes, so
``trustedScriptUrl`/\\evil.example/app.js` `` selects `evil.example`, just like
a leading `//`. An empty interpolation can also join literal slashes into `//`, as in
``trustedScriptUrl`/${""}/evil.example/app.js` ``. For same-origin resources, use
ordinary `/path` syntax with a fixed path prefix before interpolations (as in
``trustedScriptUrl`/api/assets/${assetId}` ``), avoid literal backslashes, and
review the resolved origin of script and frame URLs.

## Coverage, versions, and non-XSS security

This package replaces the global `Response` constructor to reject unsafe response
bodies and content types. These checks are required. They run in Node.js, so use
Node handlers when relying on them. Installation requires both the instrumentation hook and
`NODE_OPTIONS="--import next-xss-sbyd/enforce/preload"` for builds and server startup.
Follow the [installation instructions and startup-order explanation](retrofit.md#configure-the-web-application).
The constructor checks cannot prevent later header changes by application code, a
framework, a cache, a proxy, or a CDN.

The supported model is TypeScript with the recommended type-aware ESLint configuration
on the documented Next.js and React versions. Plain JavaScript, unchecked `any`, files
outside the TypeScript project, lint parser failures, ignored/generated code, unsupported
framework versions, alternate JSX runtimes, and custom servers or response objects can
reduce coverage. Re-run compatibility and adversarial integration tests when upgrading
the framework, renderer, linter, sanitizer, or runtime.

Precompiled dependencies do not inherit the application's `jsxImportSource`.
`withXssSbyd` covers their bundled React automatic-runtime imports, subject to the
limits above. Published wrappers that forward unknown props must validate those
props at their final intrinsic sink. An application can select only one JSX import source; projects
that require Emotion or another custom runtime must compose and audit a compatible
runtime or retain explicit spread protection.

This package focuses on server-side XSS. It does not provide authentication,
authorization, CSRF protection, SQL/command injection prevention, SSRF protection,
safe file handling, clickjacking policy suited to every application, secrets handling,
dependency integrity, or general business-logic security. Those risks need separate
controls and review.

<a id="practical-review-boundary"></a>

## Practical release review

Before release, verify that the application uses the required APIs and runtime checks.
Run the build and lint checks, audit exemptions, and review third-party and custom
components. Test client-side DOM operations and rendering with hostile input. Review
dependency versions and verify CSP and response headers in the deployed environment.
