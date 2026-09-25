# Sanitizing formatted HTML

For Markdown, use [`SafeMarkdown` or the final-HTML migration recipe](markdown.md).
MDX is executable application code and has a separate trust boundary.

Use `sanitizeUserHtml` to display untrusted HTML while preserving permitted
formatting, images, and media. It removes disallowed markup and returns `SafeHtml`.
Pass that value to `SafeBlock`, which renders it in the element named by `as`:

```tsx
import {SafeBlock} from "next-xss-sbyd";
import {sanitizeUserHtml} from "next-xss-sbyd/sanitize";

export function Article({html}: {html: string}) {
  return <SafeBlock as="article" html={sanitizeUserHtml(html)} />;
}
```

`sanitizeUserHtml(dirty: string): SafeHtml` is synchronous and accepts exactly one
string. Non-string input, extra arguments, unsupported environments, and engine
failures throw; there is no uncleaned fallback. Malicious HTML may become empty HTML.
This package uses one fixed sanitization policy.
For arrays, use `htmlStrings.map(dirty => sanitizeUserHtml(dirty))`: passing
`sanitizeUserHtml` directly to `map`/`forEach` throws because they supply extra arguments.
Catch sanitization errors in the fetch/render path and display an application-owned
error state; deeply nested or oversized input can exhaust parser resources.

In Node, HTML element depth above **512** throws
`TypeError: sanitizeUserHtml input exceeds the maximum HTML element depth of 512`.
Depth includes implicit `html` and `head`/`body` wrappers, parser-inserted elements
such as `tbody`, template contents, and void elements such as `br`; text, comments,
and document fragments do not count. For plain nesting inside `body`, 510 nested
`div` elements are accepted and 511 are rejected. Temporary parser nesting also
counts: foster parenting around tables or a later `frameset` can cause rejection
even when the final tree would be shallower. Apparent tags in scripts or quoted
attributes do not add depth.

Both Node entry points enforce this limit before JSDOM parses the input. It does
not bound input size, node count, CPU time, or memory. Apply application-specific
size limits and catch sanitization errors. The depth error deliberately retains
`TypeError`, as specified in #221; caller mistakes also throw that class, so do not
use the error class to distinguish hostile input from programming errors.

The universal import uses DOMPurify to sanitize HTML in both browsers and Node.
Each environment uses a private instance. Node uses JSDOM to parse the HTML. The browser
module can be imported without a `window` global; its private DOMPurify instance is
created on the first call. Edge import succeeds, but calling throws a
supported-environment error. DOM-less workers are also unsupported. There is no public
`sanitize-browser` entry point. `sanitize-node` remains the Node alias with the same
one-argument signature and new policy. Dependencies are included with this package;
no `isomorphic-dompurify` installation is required.

A Next.js client component can render on Node before running in the browser. The
universal import supports both stages, including render/`useMemo` calls. Browser and
Node parsers need not produce byte-identical serialization for malformed input; verify
hydration for representative inputs. Above the Node depth limit, the server throws
while browsers can flatten the same HTML and sanitize successfully. Decide the
fallback on the server and pass rendered content or the fallback decision down,
rather than re-sanitizing that input during client rendering. Do not serialize
`SafeHtml` objects across environments (see Transport and SafeBlock below). Avoid sanitizing large documents on unrelated
renders: synchronous parsing can block the browser.

## Exact policy

Retained elements:

| Content | Elements |
| --- | --- |
| Formatting and tables | `a b blockquote br caption code del em h1 h2 h3 h4 h5 h6 hr i li ol p pre s strong table tbody td tfoot th thead tr u ul` |
| Additional structure | `div span figure figcaption mark sub sup dl dt dd` |
| Resources | `img audio video`, and `source` directly inside sanitized `audio`/`video` |

Unsupported ordinary wrappers are removed while safe text/children survive. Dangerous
subtrees such as scripts, styles, templates, SVG, and MathML are discarded. Forms,
controls, frames, plugins, document metadata, custom elements, `track`, `picture`, and
embedded players are not supported. Elements carrying an `is` attribute are removed
entirely, including their text and children.

| Element | Attributes and enforced behavior |
| --- | --- |
| All retained elements | Only common `title` and `aria-label` text attributes; remove `class`, `style`, `id`, `name`, event attributes, all `data-*`, all other `aria-*`, and other unlisted attributes. |
| `a` | Validated `href`; discard supplied `target`, `rel`, `download`, `ping`. Every link with retained `href`, including root-relative links, receives exactly `rel="nofollow noopener noreferrer"`. No retained `href` means no `rel`. |
| `td`, `th` | Text `abbr`; `scope` exactly `row`, `col`, `rowgroup`, or `colgroup`; decimal `colspan`/`rowspan` from 1–1000. Remove `headers` and `aria-describedby` everywhere; supplied IDs cannot target application elements. |
| `mark`, `span` | Common text attributes only. No annotation metadata, including `data-highlight-id`. |
| `img` | Validated `src`, text `alt`, decimal `width`/`height` from 1–10000; always `referrerpolicy="no-referrer"`. Remove `srcset` and supplied loading attributes. An invalid `src` is removed, preserving the element and alternative text. |
| `audio`, `video` | Validated `src`; video also accepts validated `poster` and image dimension bounds. Always `controls` and `preload="none"`; remove autoplay, loop, and other supplied playback attributes. Safe fallback children, including download links, survive. |
| `source` | Validated `src`; optional `type` exactly `audio/mpeg`, `audio/mp4`, `audio/ogg`, `audio/wav`, `audio/webm`, `video/mp4`, `video/ogg`, or `video/webm`. Unsupported type is removed. Missing/invalid source URL or a direct parent other than audio/video removes the entire element. |

Numbers must contain only ASCII decimal digits within bounds. Signed, fractional,
exponent, unit-bearing, whitespace-containing, empty, and out-of-range values are
removed. Accepted values serialize as canonical decimal integers. Attributes never
carry over to unrelated elements. Text attributes preserve colons and punctuation,
including `aria-label="Warning: hot"`, `title="Warning: hot"`, and colon-containing
`alt`/`abbr`; treating these as text does not bypass URL, enum, or numeric validation.

The shared pipeline validates decoded attributes after HTML parsing with
`navigationUrlOrNull()` for links and `resourceUrlOrNull()` for resources, writing their
canonical output. Resource URLs allow HTTP(S) and root-relative paths. Links also
allow supported `mailto:` and `tel:` forms. Invalid attributes disappear, with the
source-element exception above. Script URLs, credentials, forbidden whitespace/control
characters, backslashes, protocol-relative URLs, and all `data:`/`blob:` URLs are
rejected, including image data URLs DOMPurify might otherwise retain.

There is no base-URL argument. Resolve `images/a.png` against the original article URL
in reviewed importer code before final sanitization. Bare `#fragment` links and supplied
IDs are unsupported. The host document must not use an external base that changes
root-relative destinations; retain restrictive CSP `base-uri`. Saved inline images need
ordinary served files with reviewed upload validation and response headers, or a
separately reviewed custom sanitizer. An HTTP(S) SVG used as an image is permitted by
the resource validator; this does not permit inline SVG or script/frame use of its URL.
Full styling, internal anchors, annotation schemas, and archive fidelity are not promised.

## Finish HTML-string transformations first

This complete component demonstrates visible markers and native media:

```tsx
import {SafeBlock} from "next-xss-sbyd";
import {sanitizeUserHtml} from "next-xss-sbyd/sanitize";

export function LessonPreview() {
  const finishedHtml = `<p>Remember the <mark data-highlight-id="step">second step</mark>.</p>
    <audio src="/recordings/lesson.wav" controls></audio>
    <video src="/recordings/demo.webm" controls></video>`;
  const clean = sanitizeUserHtml(finishedHtml);
  return <SafeBlock html={clean} />;
}
```

Serve those media files from the application's public directory. For an editor, replace
`finishedHtml` with its completed converter output, including all string transformations
and ordinary `<mark>` insertion. Sanitize before the first display. Never insert an
unsanitized intermediate string into the page: later sanitization cannot undo earlier
execution or network activity. Do not concatenate or change serialized sanitized output.

The visible marker survives, but `data-highlight-id` does not. Keep saved annotation
records outside HTML; string transformations cannot preserve annotation identity through
this policy. Applications needing interactive records should use the following recipe.

## DOM-side interactive highlights

The runnable [lifecycle component](../fixtures/next14/app/sanitizer-lifecycle/client.tsx)
implements browser fetching, replacement, saved ranges, and cleanup. The same fixture
runs under Next 15/16 and through the Pages route `/legacy-sanitizer`. Its production
browser checks are in [scripts/sanitizer-lifecycle.mjs](../scripts/sanitizer-lifecycle.mjs);
run `npm run test:compat` from the repository root with the fixture dependencies and
browser prerequisites installed. This is an executable integration example, not a
promise that every arbitrary DOM operation is safe.

Follow this order:

```text
Fetch/generate HTML → finish string changes → sanitize → store SafeHtml
                   → display SafeBlock → run DOM readers/highlight effects
```

The parent owns cleaned content and article readiness. Its initial server output and
first browser render use the same loading state. Fetch handling validates the
response and sanitizes its HTML string. It cancels superseded requests and discards results if a newer request has started.
Effects depend on cleaned content and saved highlights and
check that the article container exists. Sanitizing only in a child can cause a parent
highlighter to run before text is present.

After display, locate saved ranges in text nodes and create fixed `<mark>` elements.
The example deliberately supports a range contained in one text node and ignores
unmatchable ranges; it is not a general multi-node annotation engine.
Keep marker-to-record associations in application-owned state, such as a `WeakMap`
keyed only by elements the application created. An imported `<mark>` must not acquire
permission to invoke a saved-record operation. Validate record authorization in the
application regardless of sanitization. Reload/restoration and content replacement
must rebuild associations against the current text.

Do not insert HTML strings or set styles, URL attributes, or event attributes in this
recipe. Register application listeners through the reviewed integration and remove them
on cleanup. Unwrap only application-created markers, preserving article text and
imported markers. Repeated effects must not accumulate listeners or nested owned
markers. The fixture checks restoration, replacement, stale fetch results, repeated
effects, cleanup, and imported markers.

## Transport and SafeBlock

Store `SafeHtml | null` in the parent for a browser-fetched article and pass the actual
value to `SafeBlock`. JSON, caches, storage, and worker messages carry ordinary data;
sanitize received strings again even if a server previously cleaned them. A cast,
spread/copy, or JSON round trip cannot construct or preserve `SafeHtml` object identity.
Server-only rendering can sanitize and consume a value within that environment.
Server-rendered interface content passed to a client component is a separate framework
mechanism; it does not serialize the `SafeHtml` object.

Use `sanitizeUserHtml` and `SafeBlock` for this workflow. They require no restricted
imports, raw HTML insertion, unsafe casts, or lint suppressions. A second physical
SafeValues installation does not recognize objects created by the first copy.
Use one installed copy to create and consume `SafeHtml` values.

## Resources, privacy, and CSP

Sanitized HTML can load images, posters, and media. Limit CSP `img-src` and `media-src`
to intended destinations, such as `'self'` and specifically reviewed hosts, while
preserving strict script directives and restrictive `base-uri`. To configure CSP with this
package, use the `imgSrc` and `mediaSrc` source lists; see the
[CSP rollout guide](csp-rollout.md). Never automatically widen CSP to recover a picture.
Privacy-sensitive applications can use a separately reviewed proxy, which needs its own
server-request/upload protections.

To require sanitization before HTML reaches dangerous sinks, such as `innerHTML`,
you can enforce Trusted Types with `require-trusted-types-for 'script'`. Allow
DOMPurify's `dompurify` policy name in your `trusted-types` directive (or
`dompurify#<suffix>` when using DOMPurify's `data-tt-policy-suffix`). Denying that
policy makes the browser adapter throw an engine-failure error; it never returns
uncleaned HTML. This package's CSP builder does not emit Trusted Types directives,
so its default configuration is unaffected.

Images use `no-referrer`, but requests still reveal IP addresses and timing and may
carry cookies subject to browser rules. Media referrers depend on document policy.
`preload="none"` is a hint, not a guarantee or consent mechanism. Safe URLs do not
validate media bytes or prevent decoder vulnerabilities. Same-site endpoints must not
change state on GET. Parsing can itself attempt requests or emit CSP reports before
removal; record that separately from displayed content. Preventing all imported-host
contact requires isolation established before parsing. See [caveats](caveats.md).

See the [validation matrix and measured bundle/latency results](sanitize-validation.md).

## Isolated document previews

Prefer `SafeBlock` for in-page content. Use `SafeHtmlIframe` only when the
content needs a separate document: frames add layout, focus, accessibility and
styling costs. This API is distinct from the URL-based `SafeIframe` and is not a
PDF viewer or general embed component.

```tsx
import {SafeHtmlIframe} from "next-xss-sbyd/safe-html-iframe";

export function Preview({html}: {html: string}) {
  return <SafeHtmlIframe value={html} title="Article preview" width="100%" height={400} />;
}
```

`value` must be a string and `title` a nonempty descriptive string. Accepted optional
props are `id`, `className`, `width`, `height`, `loading`, `tabIndex`, `role`,
`aria-label`, `aria-describedby` and `aria-labelledby`. Client components can supply
an object or callback `ref` to the `HTMLIFrameElement`, for example to focus it.
The opaque origin prevents the parent from reading its document. Refs are trusted
application capabilities; do not use them to replace `srcdoc` or weaken the sandbox.
Unknown props throw at runtime, including casing variants of `src`, `srcDoc`,
`sandbox`, raw HTML, children, event handlers and referrer-policy overrides.

The component uses the same fixed sanitizer and always sets `sandbox=""`.
It prepends a UTF-8 charset declaration and `<meta name="referrer"
content="no-referrer">` to the sanitized document. That inner metadata suppresses
referrers on resource requests; the iframe's own `referrerpolicy="no-referrer"`
attribute does not control requests from its `srcdoc` document.
It grants no script, same-origin, form, popup,
download or top-navigation permission. Parent styles do not style the inner
document. Clicking a sanitized link can replace the frame with a remote page
from any origin permitted by the parent's CSP. That page remains sandboxed, but
can display misleading content, including a login-looking form, inside your UI.
Restrict `frame-src` (or its `child-src` fallback) to intended navigation origins;
`about:srcdoc` documents remain permitted. Sanitized links cannot target the top
page. Do not rely on a frame to make content or links trustworthy.

Node SSR serializes sanitized content. Hydration sanitizes again and installs the
browser-authenticated HTML through the DOM `srcdoc` property, preserving
`TrustedHTML` identity. The server-component conditional export renders without
client hooks or refs. Edge and DOM-less workers fail explicitly, as with the HTML
sanitizer; there is no raw-string fallback. Client rendering uses a commit-time
layout-effect assignment, so an initially empty frame is possible before React commits.
Hydration intentionally replaces the SSR document once so the browser sanitizer
authenticates the displayed content, even when its serialization matches the server.
This can cause a second initial load. Subsequent parent renders, presentation-prop
changes and ref identity changes preserve the document while `value` is unchanged.
Changing `value` sanitizes and replaces the document, resetting its reading position.
Sanitizer errors should be handled by the application's error boundary.

Trusted Types enforcement is supported without a default policy when
`trusted-types` allows **both `dompurify` and `google#safe`**, the policy names used
by DOMPurify and SafeValues. The private sanitizer must create its policy and the
browser sink must receive authenticated `TrustedHTML`; denying either policy fails
closed. Do not create a permissive default policy to work around errors. This does
not add Trusted Types support to other components or change the CSP builder.

The sandbox is **not a network firewall**. The `about:srcdoc` document inherits the
embedding document's CSP; restrict `img-src` and `media-src` to intended hosts.
A restrictive inherited policy can block otherwise permitted images or media.
The inner referrer metadata covers images, audio, video and posters without
requiring a host HTTP `Referrer-Policy` header. After link navigation, a remote
document controls its own referrer policy. Requests can still reveal IP addresses
and timing and may carry cookies.

Root-relative resources such as `/assets/image.png` resolve using the embedding
page's base URL. Document-relative URLs such as `image.png` are removed by the
sanitizer; absolute HTTP(S) URLs remain subject to CSP. Keep a restrictive `base-uri`
policy and do not use an external base URL. Imported `<base>` and CSP `<meta>` tags
are removed. Sanitization itself may attempt requests before removing markup;
network tests distinguish parsing from the displayed document.

The [browser fixture](../scripts/test-sanitized-frame-browser.mjs) checks Chromium,
Firefox and WebKit, SSR/hydration, stable documents across parent renders and ref
changes, CSP/resource behavior, referrer suppression and link navigation. Trusted
Types allowed/denied policy cases run on every engine exposing `trustedTypes`.
The Next.js compatibility matrix also exercises server and client consumers on
Next 14 (React 18), Next 15 and Next 16 (React 19).
The [HTML iframe specification](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#the-iframe-element)
and [CSP inheritance rules](https://w3c.github.io/webappsec-csp/#csp-inheriting-to-avoid-bypasses)
describe the underlying browser isolation model.
