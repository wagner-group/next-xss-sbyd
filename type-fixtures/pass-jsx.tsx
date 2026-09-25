import {SafeExternalIframe, SafeIframe, trustedResourceUrl} from "next-xss-sbyd";

const src = trustedResourceUrl`https://video.example/embed/player`;

<SafeExternalIframe src={src} sandbox="" title="Static document" />;
<SafeExternalIframe src={src} sandbox="allow-scripts" title="Scripted embed" onLoad={() => undefined} />;
// @ts-expect-error SafeExternalIframe requires a sandbox policy.
<SafeExternalIframe src={src} />;
// @ts-expect-error SafeExternalIframe accepts only its fixed sandbox profiles.
<SafeExternalIframe src={src} sandbox="allow-same-origin" />;
// @ts-expect-error SafeExternalIframe rejects the sandbox-escape-prone scripts/same-origin pairing.
<SafeExternalIframe src={src} sandbox="allow-scripts allow-same-origin" />;
// @ts-expect-error SafeExternalIframe does not accept srcDoc.
<SafeExternalIframe src={src} sandbox="" srcDoc="<p>unsafe</p>" />;
// @ts-expect-error SafeExternalIframe requires TrustedResourceUrl rather than a string.
<SafeExternalIframe src="https://video.example/embed/player" sandbox="" />;

// The deprecated name retains the same JSX contract.
<SafeIframe src={src} sandbox="" />;
// @ts-expect-error The deprecated name still requires TrustedResourceUrl.
<SafeIframe src="https://video.example/embed/player" sandbox="" />;
