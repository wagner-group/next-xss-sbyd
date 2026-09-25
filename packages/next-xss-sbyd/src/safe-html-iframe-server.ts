import {createElement} from "react";
import type {ReactElement} from "react";
import {prepareFrame, sanitizeFrame} from "./internal/sanitized-frame.js";
import type {SafeHtmlIframeProps} from "./internal/sanitized-frame.js";

export type {SafeHtmlIframeProps} from "./internal/sanitized-frame.js";

/** Serializes a sanitized document in a server component; DOM refs require a client component. */
export function SafeHtmlIframe(props: SafeHtmlIframeProps): ReactElement {
  if ("ref" in props) throw new TypeError("SafeHtmlIframe refs require a client component");
  const frameProps = prepareFrame(props);
  const html = sanitizeFrame(props.value);
  return createElement("iframe", {...frameProps, srcDoc: String(html)});
}
