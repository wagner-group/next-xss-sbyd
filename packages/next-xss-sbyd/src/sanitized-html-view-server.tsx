import type {ReactElement} from "react";
import {renderSanitizedHtmlView} from "./internal/sanitized-html-view.js";
import type {SanitizedHtmlViewContentProps} from "./internal/sanitized-html-view.js";

export interface SanitizedHtmlViewProps extends SanitizedHtmlViewContentProps {
  readonly ref?: never;
}

/** Sanitizes and renders within the server environment without transporting branded values. */
export function SanitizedHtmlView(props: SanitizedHtmlViewProps): ReactElement {
  if ("ref" in props) throw new TypeError("SanitizedHtmlView refs require a client component");
  return renderSanitizedHtmlView(props);
}
