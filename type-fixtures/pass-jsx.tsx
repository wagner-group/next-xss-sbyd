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
