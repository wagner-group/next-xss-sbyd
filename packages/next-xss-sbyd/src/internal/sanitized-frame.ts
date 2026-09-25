import type {ComponentPropsWithoutRef} from "react";
// Resolve the conditional export so Node, browser and Edge select their own adapter.
import {sanitizeUserHtml} from "next-xss-sbyd/sanitize";
import {concatHtmls, unwrapHtml} from "safevalues";
import {htmlSafeByReview} from "safevalues/restricted/reviewed";

const PRESENTATION_PROPS = [
  "id", "className", "width", "height", "loading", "tabIndex", "role",
  "aria-label", "aria-describedby", "aria-labelledby",
] as const;
const presentationProps = new Set<string>(PRESENTATION_PROPS);

export interface SafeHtmlIframeProps extends Pick<ComponentPropsWithoutRef<"iframe">,
  (typeof PRESENTATION_PROPS)[number]> {
  readonly value: string;
  readonly title: string;
}

/** Validates every render, independently of memoized document sanitization. */
export function prepareFrame({value, title, ...props}: SafeHtmlIframeProps) {
  for (const name of Object.keys(props)) {
    if (!presentationProps.has(name)) {
      throw new TypeError(`Unsafe SafeHtmlIframe prop: ${JSON.stringify(name)}`);
    }
  }
  if (typeof title !== "string" || title.trim() === "") {
    throw new TypeError("SafeHtmlIframe requires a nonempty title");
  }
  return {...props, title, sandbox: "", referrerPolicy: "no-referrer" as const};
}

/** Builds authenticated document metadata followed by the sanitized fragment. */
export function sanitizeFrame(value: string) {
  const fragment = sanitizeUserHtml(value);
  const metadata = htmlSafeByReview('<meta charset="utf-8"><meta name="referrer" content="no-referrer">', {
    justification: "Static document metadata without interpolated values, before any untrusted resources",
  });
  // The stringifying internal unwrap helper would destroy TrustedHTML identity.
  // SafeValues authenticates both pieces and the combined value before this sink.
  return unwrapHtml(concatHtmls([metadata, fragment]));
}
