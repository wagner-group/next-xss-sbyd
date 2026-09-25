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
import {SafeHtmlIframe} from "next-xss-sbyd/safe-html-iframe";

<SafeHtmlIframe value="<p>Preview</p>" title="Article" ref={createRef<HTMLIFrameElement>()} />;
<SafeHtmlIframe value="" title="Empty" ref={frame => { frame?.focus(); }} width={400} loading="lazy" aria-label="Preview" />;
// @ts-expect-error A descriptive title is required.
<SafeHtmlIframe value="" />;
// @ts-expect-error Only string input is accepted.
<SafeHtmlIframe value={{html: ""}} title="Preview" />;
// @ts-expect-error The sandbox is fixed.
<SafeHtmlIframe value="" title="Preview" sandbox="allow-scripts" />;
// @ts-expect-error Remote URL embeds use SafeIframe.
<SafeHtmlIframe value="" title="Preview" src="/remote" />;
// @ts-expect-error Raw srcDoc cannot replace sanitized input.
<SafeHtmlIframe value="" title="Preview" srcDoc="<script>alert(1)</script>" />;
// @ts-expect-error No raw HTML escape hatch.
<SafeHtmlIframe value="" title="Preview" dangerouslySetInnerHTML={{__html: ""}} />;
// @ts-expect-error Refs refer to the iframe element.
<SafeHtmlIframe value="" title="Preview" ref={createRef<HTMLDivElement>()} />;
// @ts-expect-error The referrer policy is fixed.
<SafeHtmlIframe value="" title="Preview" referrerPolicy="unsafe-url" />;
// @ts-expect-error Arbitrary native props are not forwarded.
<SafeHtmlIframe value="" title="Preview" onLoad={() => undefined} />;
