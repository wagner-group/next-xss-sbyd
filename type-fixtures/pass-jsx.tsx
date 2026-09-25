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
import {SanitizedHtmlView} from "next-xss-sbyd/sanitized-html-view";
import type {SanitizedHtmlViewProps} from "next-xss-sbyd/sanitized-html-view";

<SanitizedHtmlView value="<b>untrusted</b>" ref={createRef<HTMLDivElement>()} className="prose" />;
<SanitizedHtmlView as="span" value="" ref={createRef<HTMLSpanElement>()} aria-label="Preview" />;
<SanitizedHtmlView as="article" value="text" ref={createRef<HTMLElement>()} />;
<SanitizedHtmlView value="" ref={node => { node?.align; }} />;
<SanitizedHtmlView as="span" value="" ref={node => {
  node?.scrollIntoView();
  // @ts-expect-error Span refs do not have HTMLDivElement's align property.
  node?.align;
}} />;
// @ts-expect-error The untrusted string is required.
<SanitizedHtmlView />;
// @ts-expect-error SafeHtml is not an alternative content API.
<SanitizedHtmlView value="" html={{}} />;
// @ts-expect-error Only the closed inert container set is supported.
<SanitizedHtmlView as="script" value="" />;
// @ts-expect-error Children cannot replace sanitized content.
<SanitizedHtmlView value="">child</SanitizedHtmlView>;
// @ts-expect-error Raw HTML cannot replace sanitized content.
<SanitizedHtmlView value="" dangerouslySetInnerHTML={{__html: "unsafe"}} />;
// @ts-expect-error The default div requires a compatible DOM ref.
<SanitizedHtmlView value="" ref={createRef<SVGElement>()} />;
// @ts-expect-error A span ref cannot stand in for the default div ref.
<SanitizedHtmlView value="" ref={createRef<HTMLSpanElement>()} />;
const forbiddenContent = {value: "", html: "unsafe", children: "unsafe"};
// @ts-expect-error Even structurally assignable spreads must exclude reserved content props.
<SanitizedHtmlView {...forbiddenContent} />;
const validViewProps: SanitizedHtmlViewProps = {as: "section", value: "text", ref: createRef<HTMLElement>()};
<SanitizedHtmlView {...validViewProps} />;
