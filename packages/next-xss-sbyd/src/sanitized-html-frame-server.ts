import {createElement} from "react";
import type {ReactElement} from "react";
import {prepareFrame} from "./internal/sanitized-frame.js";
import type {SanitizedHtmlFrameProps} from "./internal/sanitized-frame.js";

export type {SanitizedHtmlFrameProps} from "./internal/sanitized-frame.js";

/** Serializes a sanitized document in a server component; DOM refs require a client component. */
export function SanitizedHtmlFrame(props: SanitizedHtmlFrameProps): ReactElement {
  const {html, props: frameProps} = prepareFrame(props);
  return createElement("iframe", {...frameProps, srcDoc: String(html)});
}
