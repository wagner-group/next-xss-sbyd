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

Preview revocation is immediate. Download revocation marks the handle revoked
immediately, then releases the native URL in the next timer task; download cleanup
also defers removing `href`. This preserves the link's default action when cleanup
runs during a click, including an ancestor capture handler. It does not revoke on
load or automatically on click. Keep long-lived links mounted while users need
them. Browser download completion is not observable by ordinary page JavaScript;
this task-boundary policy is tested in the browser matrix below, not a guarantee
about every browser or external download manager. Do not revoke before the user
initiates a download that still needs the URL.

Ordinary navigation/resource validators still reject every `blob:` string. The
handle is not a TrustedResourceUrl. There are no iframe, script, object or embed
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
`tmp/object-url/results.json` on each run. Lifecycle evidence currently uses
React 19.2.8 on Linux; this suite has not verified React 18, which remains in the
package peer range. It verifies actual PNG/JPEG/GIF decoding, downloaded file bytes,
manual revocation, replacement/unmount cleanup, Strict Mode cleanup, failed
renders and failed attachment, and download cleanup during click dispatch. DOM
mutation observation records URLs so tests can verify that fetching them fails
after cleanup; no native API is mocked.

For each permitted MIME essence, the suite navigates HTML and XHTML script
payloads with and without a quoted charset parameter, without CSP or nosniff.
A Blob labeled `text/html` is the positive execution control. WebKit requires
navigation in the creator page: its Playwright build rejects Blob navigation
from a separately created blank page, even for the HTML positive control.

MIME declarations **do not validate bytes**. These tests establish browser
behavior for these cases, not immunity to browser bugs, image decoder bugs or all
polyglot files. Downloaded files may execute if opened in another application or
renamed; filenames and external opening are outside this guarantee. Broader
media types require new navigation and decoding evidence before admission.

Relevant platform references: [File API](https://www.w3.org/TR/FileAPI/) and
[Blob URL lifecycle guidance](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/blob).
