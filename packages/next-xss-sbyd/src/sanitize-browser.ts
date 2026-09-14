import type {DOMPurify} from "dompurify";
import type {SafeHtml} from "safevalues";
import {createSanitizer, sanitizeWith} from "./internal/sanitize.js";
import {checkSanitizerInput} from "./internal/sanitize-input.js";

let privatePurifier: DOMPurify | undefined;

/** Sanitizes untrusted HTML using a lazily initialized, private browser DOM adapter. */
export function sanitizeUserHtml(dirty: string): SafeHtml {
  checkSanitizerInput(dirty, arguments.length);
  if (typeof window === "undefined") {
    throw new Error("sanitizeUserHtml requires a supported DOM or Node adapter; workers without a DOM are unsupported");
  }
  privatePurifier ??= createSanitizer(window);
  return sanitizeWith(privatePurifier, dirty);
}
