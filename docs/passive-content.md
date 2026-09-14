# Passive response content types

Here, *passive* means the response is handled as data, media, or a download instead
of an attacker-authored scriptable document during browser navigation. It does not
promise that every browser decodes each format, validate file bytes, prevent decoder
vulnerabilities, or make downloaded files safe to open in another application.
Font hinting and spreadsheet formulas are outside this document-script policy.

A MIME type is the `type/subtype` label in the HTTP `Content-Type` header. Its
*essence* is that label without parameters: `text/plain; charset=utf-8` has the
essence `text/plain`. The allowlist compares names case-insensitively and accepts
valid parameters. Missing, malformed, comma-joined, and unlisted types are rejected.

Three APIs share this policy:

- `installResponseGuard()` installs a global Fetch `Response` constructor guard
  in Node, checking raw string bodies and JSON output. Existing constructor
  exceptions for non-string bodies remain unchanged.
- `withSafeApiRoute()` wraps an individual Pages API or Node handler, checking
  its ordinary string and byte writes and adding methods for HTML produced by the
  package's safe APIs.
- `passiveResponse()` checks a fetched response's type and status before returning
  a new response with filtered headers and `nosniff`. It preserves the body stream.

| Group | Allowed MIME types |
| --- | --- |
| Calendar and playlists | `text/calendar`, `application/vnd.apple.mpegurl`, `audio/mpegurl`, `application/x-mpegurl`, `audio/x-mpegurl` |
| Text and data | `text/plain`, `text/csv`, `text/tab-separated-values`, `text/event-stream`, `text/vtt`, `text/markdown`, `application/json`, `application/x-ndjson`, `application/ndjson`, `application/octet-stream`, syntactically valid `application/*+json` with a nonempty prefix before `+json` |
| Form data | `application/x-www-form-urlencoded`, `multipart/form-data` |
| WebAssembly | `application/wasm` |
| Office documents | `application/msword`, `application/vnd.ms-excel`, `application/vnd.ms-powerpoint`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/vnd.openxmlformats-officedocument.presentationml.presentation` |
| Raster images | `image/tiff`, `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/avif`, `image/apng`, `image/bmp`, `image/x-icon`, `image/vnd.microsoft.icon` |
| Audio | `audio/aac`, `audio/aiff`, `audio/flac`, `audio/midi`, `audio/mp4`, `audio/mpeg`, `audio/ogg`, `audio/wav`, `audio/wave`, `audio/webm`, `audio/x-aiff`, `audio/x-flac`, `audio/x-midi`, `audio/x-wav` |
| Video and Ogg | `video/mp4`, `video/mpeg`, `video/ogg`, `video/quicktime`, `video/webm`, `video/x-msvideo`, `application/ogg` |
| Fonts | `font/collection`, `font/otf`, `font/sfnt`, `font/ttf`, `font/woff`, `font/woff2`, `application/font-cff`, `application/font-otf`, `application/font-sfnt`, `application/font-ttf`, `application/font-woff`, `application/vnd.ms-fontobject`, `application/vnd.ms-opentype` |
| Archives | `application/zip`, `application/gzip`, `application/x-gzip`, `application/x-tar`, `application/x-7z-compressed`, `application/vnd.rar`, `application/x-rar-compressed` |

Keep `X-Content-Type-Options: nosniff` on responses and preserve the checked
`Content-Type` through middleware and proxies. `passiveResponse()` forces `nosniff`;
the ordinary constructor and Node wrapper do not add it for passive bodies.
Without `nosniff`, non-JavaScript types can still be accepted at classic script
destinations. The allowlist does not authorize untrusted script URLs or subsequent
insertion of fetched data into HTML. See the [Fetch nosniff rules](https://fetch.spec.whatwg.org/#should-response-to-request-be-blocked-due-to-nosniff).

## Why these types

The [MIME Sniffing Standard](https://mimesniff.spec.whatwg.org/#determining-the-computed-mime-type-of-a-resource)
separates XML/HTML handling from image and audio/video sniffing. Its image patterns
produce raster types, not SVG. The [HTML navigation rules](https://html.spec.whatwg.org/multipage/browsing-the-web.html#read-html)
distinguish text, media, PDF viewers, and unsupported-format downloads.
[Chromium](https://github.com/chromium/chromium/blob/main/third_party/blink/common/mime_util/mime_util.cc)
and [WebKit](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/MIMETypeRegistry.cpp)
maintain separate document/media classifications. These support an explicit list,
not a claim about every current or future subtype.

[CSV](https://www.rfc-editor.org/rfc/rfc4180.html) and
[server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream)
are data formats. The font types and historical aliases follow
[RFC 8081](https://www.rfc-editor.org/rfc/rfc8081.html); its security considerations
also explain why accepting font responses is not a general font-safety guarantee.

The inclusion criterion is browser navigation as data, media, or a download,
with no attacker-authored document scripting. The exact list covers reviewed
raster/audio/video types and aliases, RFC 8081 fonts, and the fixed text/data,
form, archive, Office, and WebAssembly entries above. This is not a MIME-family
rule. Calendar, TIFF, and HLS/M3U playlists include compatibility aliases. Markdown, NDJSON, and URL-encoded forms are data;
converting Markdown to HTML still requires HTML sanitization. `multipart/form-data`
is allowed as form data, including uploaded file parts; it does not authorize
rendering those parts as documents. Browser registries distinguish it from
`multipart/x-mixed-replace` and `multipart/related`, which remain excluded.

WebAssembly does not run on navigation; the [WebAssembly Web API](https://webassembly.github.io/spec/web-api/index.html#streaming-modules)
requires explicit compilation and instantiation. This allowlist does not authorize
executing untrusted modules. Office files are accepted as downloads or native previews;
this is not a guarantee about macros, external applications, or previewer bugs.
[Chromium's Office MIME sniffing](https://github.com/chromium/chromium/blob/main/net/base/mime_sniffer.cc)
checks file signatures and downgrades mismatches to `application/octet-stream`.

`image/svg+xml`, XML (including arbitrary `+xml` types), HTML, JavaScript, CSS,
other multipart types, `message/rfc822`, and unknown types remain excluded. SVG has
[scripting support](https://www.w3.org/TR/SVG2/interact.html#ScriptElement).
PDF also remains excluded: it has
[JavaScript APIs](https://opensource.adobe.com/dc-acrobat-sdk-docs/library/jsapiref/index.html)
and browser-specific viewer behavior. For PDF downloads use
`application/octet-stream` with `Content-Disposition: attachment`; inline PDF
viewing needs a separately reviewed route. There are no `image/*`, `audio/*`,
`video/*`, `font/*`, or `application/*+zip` wildcards.

For an unlisted format, use `application/octet-stream` with
`Content-Disposition: attachment`. This forces a download and does not support
inline images such as HEIC. Inline use requires a separately reviewed route.
To propose another type, supply its format specification and real-HTTP browser
checks of HTML and XHTML attack bodies in Chromium, Firefox, and WebKit with
`nosniff`, then update the exported list, independent HTTP cases, and this table.
CSS remains outside this fixed policy; exclusion alone does not establish that
a type executes JavaScript during navigation.

## Verification and shared predicate

Run `npm run build`, `node --test tests/issue-224.test.mjs`, and
`npm run test:passive-browser`. The HTTP test exercises string,
JSON, byte, stream, and proxy responses. The browser probe navigates to executable
HTML mislabeled with every listed type, both through the Node wrapper and through
the proxy with `nosniff`, with an executing HTML positive control. It also checks
valid `multipart/form-data` containing an HTML file part. It requires
Chromium, Firefox, and WebKit; `PASSIVE_BROWSERS` can select installed engines.
These are regression checks for tested browser versions, not proof about all browsers.

Tooling can import `isPassiveMediaType` from `next-xss-sbyd/passive-content` to use
the same strict parser and policy without importing Node enforcement or installing
a guard. A true result checks the supplied header only, not a response's body,
other headers, final wire representation, or later mutations.
