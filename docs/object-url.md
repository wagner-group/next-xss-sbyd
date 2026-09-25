# Checked browser object URLs

Import from `next-xss-sbyd/object-url` in a client component. The initial policy
permits **image/png, image/jpeg and image/gif**, for downloads or raster previews.
It reuses the strict passive MIME parser, then narrows its allowlist because Blob
navigation cannot supply response headers such as `X-Content-Type-Options: nosniff`.
Missing types, malformed parameters, HTML, SVG, XML, JavaScript, CSS, PDF and all
other types are rejected. MediaSource is not a Blob; its native workflows require
a separately reviewed lint exception, not a cast.

```tsx
import {PassiveObjectUrlPreview, PassiveObjectUrlDownload} from 'next-xss-sbyd/object-url';

<PassiveObjectUrlPreview blob={photo} alt="Selected photo" />
<PassiveObjectUrlDownload blob={photo} filename="photo.png">Download</PassiveObjectUrlDownload>
```

These components own their URLs. They allocate after React commits, release the
previous URL on Blob replacement, and release the current URL on unmount. They
work with Strict Mode effect replay. Abandoned/failed renders allocate nothing;
attachment failures after allocation revoke before propagating the error. Server
rendering produces an image without `src` or a link without `href`.

`filename` must be a nonempty primitive string; invalid filenames throw during
render, before an Effect can allocate a URL. Blob identity and MIME validation
run in the Effect before allocation. The TypeScript API requires a string `alt`,
including `""` for decorative images. At runtime, alt text retains ordinary React
handling and escaping, including for untyped legacy callers; it is not a URL or
HTML sink. Missing alt text should be caught by accessibility checks rather than
making an XSS retrofit fail at runtime. Extra props are ignored, not forwarded.

If the application uses CSP, explicitly allow `blob:` in `img-src` for previews
(for example, `createXssSbydHandler({imgSrc: ["'self'", "blob:"]})`). The default
policy permits only self-hosted images. Do not add `blob:` to active directives
such as `script-src` or `frame-src`.

For non-React code, `createPassiveObjectUrl(blob, use)` returns a frozen handle
with `url`, `mediaType`, `use` and a live `revoked` getter. `use` is required: pass
`"download"` or `"raster-preview"` explicitly. A private WeakMap authenticates
identity. Copies, serialized handles, arbitrary Blob strings and revoked handles
cannot be attached. Handles from another package instance are also rejected.

Use `attachPassiveObjectUrlPreview(image, handle)` or
`attachPassiveObjectUrlDownload(anchor, handle, filename)`. Each returns a cleanup
function which detaches its URL and revokes the handle. Each handle permits only
one attachment; a second attachment throws without changing the first. Create a
fresh handle per attachment, call cleanup before replacement
or removal, and revoke explicitly if attachment fails. `revokePassiveObjectUrl`
is idempotent for authentic handles. Do not create URLs during a render function.

Imperative attachment assumes native, unmodified DOM setters. Validation failures
leave the handle available for a corrected attempt. If application code overrides
a setter and it throws during assignment, the adapter does not promise rollback
or automatic revocation; imperative callers must revoke when abandoning a handle:

```ts
const handle = createPassiveObjectUrl(photo, 'raster-preview');
try {
  const cleanup = attachPassiveObjectUrlPreview(image, handle);
  // Retain cleanup and call it before replacement or removal.
} catch (error) {
  revokePassiveObjectUrl(handle);
  throw error;
}
```

The React components already provide this failure cleanup. Modified platform APIs
are outside the adapters' security contract.

Preview revocation is immediate. Download revocation marks the handle revoked
immediately, then releases the native URL in the next timer task; download cleanup
also defers removing `href`. This preserves the link's default action when cleanup
runs during a click, including an ancestor capture handler. It does not revoke on
load or automatically on click. Keep long-lived links mounted while users need
them. Browser download completion is not observable by ordinary page JavaScript;
this task-boundary policy is tested in the browser matrix below, not a guarantee
about every browser or external download manager. Do not revoke before the user
initiates a download that still needs the URL.

`validateUrl` and `validateUrlOrNull` still reject every `blob:` string. The
handle is not a `TrustedScriptUrl`. There are no iframe, script, object or embed
adapters. The adapters accept only their documented props and do not forward
arbitrary attributes. The recommended ESLint preset rejects native creation,
including references passed as callbacks, typed aliases, destructuring, reflective
invocation arguments and statically resolved computed access. Named
`createObjectURL` access on `any`, `unknown` or unresolved receivers also reports.
User-declared structural method types remain exempt, even when a native `URL`
value is passed to them; computed names with no finite literal type and reflective
property lookup need manual review. The rule has no filename/directory exemption.
Only the checked implementation's single native call has a scoped, justified disable.

The readable `url` property is retained for diagnostics and checking URL lifetime
(for example, fetching it to verify revocation). It is not a safe URL brand or
permission to use another sink. Direct DOM assignments and `window.open` can
bypass the adapters and require application review.

## Browser evidence and limits

`npm run test:object-url-browser` runs Chromium, Firefox and WebKit through
Playwright and writes the actual browser and React versions to
`tmp/object-url/results.json` on each run. The additional lifecycle runner uses
the pinned React 18 Next.js fixture and the workspace React 19, recording versions
in `tmp/object-url-lifecycle/results.json`. Install the Next.js 14 fixture's
dependencies before running (`npm ci --prefix fixtures/next14`), as CI does.
The suites verify actual PNG/JPEG/GIF decoding, downloaded file bytes,
manual revocation, replacement/unmount cleanup, Strict Mode cleanup, failed
renders, hydration, alt/children updates without reallocation, invalid filenames,
and download cleanup during unmount or replacement in click dispatch. DOM
mutation observation records URLs so tests can verify that fetching them fails
after cleanup; no native API is mocked.

For each permitted MIME essence, the suite navigates HTML and XHTML script
payloads with and without a quoted charset parameter and matching file-signature
prefixes, without CSP or nosniff and with the package's production CSP. A Blob
labeled `text/html` is the positive execution control without CSP; the production
policy must block that control. Preview checks prove that explicit `img-src blob:`
allows decoding and its omission produces an image CSP violation. WebKit requires
navigation in the creator page: its Playwright build rejects Blob navigation
from a separately created blank page, even for the HTML positive control.

MIME declarations **do not validate bytes**. These tests establish browser
behavior for these cases, not immunity to browser bugs, image decoder bugs or all
polyglot files. Downloaded files may execute if opened in another application or
renamed; filenames and external opening are outside this guarantee. Broader
media types require new navigation and decoding evidence before admission.

Relevant platform references: [File API](https://www.w3.org/TR/FileAPI/) and
[Blob URL lifecycle guidance](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/blob).
