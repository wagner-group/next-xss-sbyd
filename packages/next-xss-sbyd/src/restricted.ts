import {
  htmlSafeByReview,
  resourceUrlSafeByReview,
  scriptSafeByReview,
  styleSheetSafeByReview,
} from "safevalues/restricted/reviewed";
import type {SafeHtml} from "safevalues";

export {htmlSafeByReview, resourceUrlSafeByReview, scriptSafeByReview, styleSheetSafeByReview};

/** Converts reviewed HTML to SafeHtml through the conspicuous restricted entry point. */
export function unsafeHtmlDoNotUseOrReviewCarefully(html: string, justification: string): SafeHtml {
  if (typeof justification !== "string" || justification.trim() === "") {
    throw new TypeError("A non-empty security review justification is required");
  }
  return htmlSafeByReview(html, {justification});
}
