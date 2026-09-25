import type {ComponentPropsWithoutRef} from "react";
import {sanitizeUserHtml} from "next-xss-sbyd/sanitize";
import {unwrapHtml} from "safevalues";

export interface SanitizedHtmlFrameProps extends Pick<ComponentPropsWithoutRef<"iframe">,
  "id" | "className" | "width" | "height" | "loading" | "tabIndex" | "role" |
  "aria-label" | "aria-describedby" | "aria-labelledby"
> {
  readonly value: string;
  readonly title: string;
}

const PRESENTATION_PROPS = new Set([
  "id", "className", "width", "height", "loading", "tabIndex", "role",
  "aria-label", "aria-describedby", "aria-labelledby",
]);

/** Validates the public contract and authenticates sanitized HTML for the document sink. */
export function prepareFrame({value, title, ...props}: SanitizedHtmlFrameProps) {
  for (const name of Object.keys(props)) {
    if (!PRESENTATION_PROPS.has(name)) {
      throw new TypeError(`Unsafe SanitizedHtmlFrame prop: ${JSON.stringify(name)}`);
    }
  }
  if (typeof title !== "string" || title.trim() === "") {
    throw new TypeError("SanitizedHtmlFrame requires a nonempty title");
  }
  // Preserve TrustedHTML identity. Only the server serializer may convert to string.
  const html = unwrapHtml(sanitizeUserHtml(value));
  return {html, props: {...props, title, sandbox: "", referrerPolicy: "no-referrer" as const}};
}
