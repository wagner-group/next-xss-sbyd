import {SafeIframe, trustedResourceUrl} from "next-xss-sbyd";

const src = trustedResourceUrl`https://video.example/embed/player`;

<SafeIframe src={src} sandbox="" title="Static document" />;
<SafeIframe src={src} sandbox="allow-scripts" title="Scripted embed" onLoad={() => undefined} />;
// @ts-expect-error SafeIframe requires a sandbox policy.
<SafeIframe src={src} />;
// @ts-expect-error SafeIframe accepts only its fixed sandbox profiles.
<SafeIframe src={src} sandbox="allow-same-origin" />;
// @ts-expect-error SafeIframe rejects the sandbox-escape-prone scripts/same-origin pairing.
<SafeIframe src={src} sandbox="allow-scripts allow-same-origin" />;
// @ts-expect-error SafeIframe does not accept srcDoc.
<SafeIframe src={src} sandbox="" srcDoc="<p>unsafe</p>" />;
// @ts-expect-error SafeIframe requires TrustedResourceUrl rather than a string.
<SafeIframe src="https://video.example/embed/player" sandbox="" />;

import {createRef} from "react";
import {SanitizedHtmlFrame} from "next-xss-sbyd/sanitized-html-frame";

<SanitizedHtmlFrame value="<p>Preview</p>" title="Article" ref={createRef<HTMLIFrameElement>()} />;
<SanitizedHtmlFrame value="" title="Empty" ref={frame => { frame?.focus(); }} width={400} loading="lazy" aria-label="Preview" />;
// @ts-expect-error A descriptive title is required.
<SanitizedHtmlFrame value="" />;
// @ts-expect-error Only string input is accepted.
<SanitizedHtmlFrame value={{html: ""}} title="Preview" />;
// @ts-expect-error The sandbox is fixed.
<SanitizedHtmlFrame value="" title="Preview" sandbox="allow-scripts" />;
// @ts-expect-error Remote URL embeds use SafeIframe.
<SanitizedHtmlFrame value="" title="Preview" src="/remote" />;
// @ts-expect-error Raw srcDoc cannot replace sanitized input.
<SanitizedHtmlFrame value="" title="Preview" srcDoc="<script>alert(1)</script>" />;
// @ts-expect-error No raw HTML escape hatch.
<SanitizedHtmlFrame value="" title="Preview" dangerouslySetInnerHTML={{__html: ""}} />;
// @ts-expect-error Refs refer to the iframe element.
<SanitizedHtmlFrame value="" title="Preview" ref={createRef<HTMLDivElement>()} />;
// @ts-expect-error The referrer policy is fixed.
<SanitizedHtmlFrame value="" title="Preview" referrerPolicy="unsafe-url" />;
// @ts-expect-error Arbitrary native props are not forwarded.
<SanitizedHtmlFrame value="" title="Preview" onLoad={() => undefined} />;
