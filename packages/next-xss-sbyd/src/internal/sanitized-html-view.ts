import type {ReactElement, Ref} from "react";
import {renderSafeBlock} from "../components.js";
import type {SafeBlockProps} from "../components.js";
import {sanitizeUserHtml} from "next-xss-sbyd/sanitize";

export interface SanitizedHtmlViewContentProps extends Omit<SafeBlockProps, "html"> {
  readonly value: string;
  readonly html?: never;
  readonly children?: never;
  readonly dangerouslySetInnerHTML?: never;
  readonly innerHTML?: never;
}

/** Rejects alternate content inputs and sends the fixed sanitizer output to the shared sink. */
export function renderSanitizedHtmlView({value, ...props}: SanitizedHtmlViewContentProps, ref?: Ref<HTMLElement>): ReactElement {
  for (const name of Object.keys(props)) {
    const normalizedName = name.toLowerCase();
    if (
      normalizedName === "children" ||
      normalizedName === "html" ||
      normalizedName === "innerhtml" ||
      normalizedName === "value" ||
      normalizedName.startsWith("dangerously")
    ) {
      throw new TypeError(`Unsafe SanitizedHtmlView prop: ${JSON.stringify(name)}`);
    }
  }
  return renderSafeBlock({...props, html: sanitizeUserHtml(value)}, ref);
}
