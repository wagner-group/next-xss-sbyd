# Universal sanitizer validation

This report records correctness, browser compatibility, bundle size, and latency
checks for `sanitizeUserHtml` and `SafeBlock`. DOMPurify sanitizes the HTML;
JSDOM parses it in Node. Identity checks verify that this package constructed each
`SafeHtml` object; a TypeScript cast cannot substitute for sanitization. Browser
checks also parse the cleaned HTML as displayed by `SafeBlock`.

Measured on 2026-09-13, macOS 26.6.2/arm64, Node 26.8.2, DOMPurify 3.4.15,
JSDOM 27.4.0, and Playwright Core 1.62.1. DOMPurify is a direct dependency;
JSDOM retains the repository's existing 27.4 line; its declared Node range is
`^20.19.0 || ^22.12.0 || >=24.0.0`. This run tested Node 26.8.2.
Review [DOMPurify's supported environments](https://github.com/cure53/DOMPurify#running-dompurify-on-the-server)
and [JSDOM releases](https://github.com/jsdom/jsdom/releases) when upgrading this pair.

## Dependency version policy

This package accepts DOMPurify `^3.4.15` so downstream applications can install
compatible fixes without waiting for a next-xss-sbyd release. The repository lockfile
pins 3.4.15 for reproducible validation; the measurements below apply to that version.
Applications must update their own lockfiles to receive fixes. Review DOMPurify
security releases promptly and rerun the sanitizer and browser matrix when updating
the repository lockfile.

## Browser and production matrix

| Environment | Result |
| --- | --- |
| Chromium 151.0.7922.34 | Fixed policy, SafeBlock reparsing, malicious markup, identity, workers, resource loading, CSP passed |
| Firefox 153.0 | Same browser matrix passed |
| WebKit 26.5 | Same browser matrix passed |
| Next 14.2.35, App and Pages | Production SSR/useMemo, hydration, fetch and highlight lifecycle passed |
| Next 15.5.23, App | Same production lifecycle passed |
| Next 16.3.2, App | Same production lifecycle passed |

Production fixtures used Chrome 153.0.8010.37. Pages coverage is the existing Next14
routing case; Next15/16 Pages cases were not added or claimed. Lifecycle checks include
reload/restoration, replacement, stale requests, repeated effects, listener cleanup,
and refusal to treat imported markers as authorized saved records. The example supports
saved ranges contained in one text node, not a general annotation engine.

All three browser engines decoded the local PNG and reached `loadedmetadata` and
`canplay` for WAV audio and VP8/WebM video. User-click playback succeeded for both.
Ogg/Theora was unavailable according to each engine's codec probe; it was not tested as
playable media. No proprietary codec is required. Assets are tiny generated color/tone
fixtures; generation details are in the browser test script.

Chromium recorded 58 parser-phase CSP violations for removed markup; Firefox/WebKit
recorded none. This matrix observed no parser-phase requests. Final external resources
were separately blocked by the enforcing CSP. These are observations, not a promise
that sanitization never attempts requests. Reports are recorded without global filtering.
A Chromium document denying Trusted Types policy creation exercised a sanitizer
engine failure. The sanitizer threw an explicit error and did not return uncleaned HTML.

## Bundle and latency measurements

The lists of modules included by esbuild in browser bundles contain neither JSDOM nor isomorphic-dompurify. The
combined Edge/browser package-resolution conditions select the implementation that throws on use
and include no DOM engine.
Against the same React/SafeBlock bundle without sanitization, adding the universal
sanitizer increased minified output by **32,800 bytes**, or **11,916 bytes gzip**.
This is the test application's incremental bundle cost, not every application's cost.

Five synchronous sanitizations of a 222,000-byte repeated article, with coverage
instrumentation disabled during timing:

| Engine | Samples in milliseconds |
| --- | --- |
| Chromium | 31.0, 36.8, 35.6, 28.1, 27.8 |
| Firefox | 36, 34, 33, 32, 33 |
| WebKit | 35, 29, 27, 27, 28 |

These are warmed browser-page measurements on one machine, not a cold-start benchmark
or a claim of a speedup. Large documents can block rendering.

## Reproduction and coverage limits

```sh
npm ci
node node_modules/playwright-core/cli.js install --with-deps chromium firefox webkit
npm run check
```

The compatibility runner also needs Chrome at its documented platform path or
`CHROME_PATH`. CI installs the browser matrix explicitly and requires it alongside the
existing contract and Next compatibility jobs.

`tests/issue-217.test.mjs` exercises the Node public API through actual SafeBlock
serialization/reparsing, URL sinks, numeric bounds, enum restrictions, identity checks,
and subprocess export conditions. Type fixtures reject removed policy APIs, two-argument
calls, non-string inputs, and the private browser specifier. Recommended ESLint accepts
the universal-import component without a restricted conversion or suppression. Existing
private-instance and duplicate-SafeValues diagnostics remain covered.

The browser runner writes request/CSP records, codec and timing results, and native
Chromium coverage to `tmp/browser-sanitize/`. Page coverage omits the real worker's
missing-DOM path; a separate worker test exercises it. A deficient DOM implementation
and an engine returning a wrong non-null node type cannot be produced in supported
engines without test doubles; those defensive branches are not claimed as executed.
No combined cross-runtime branch percentage is claimed.
