import type {SafeHtml} from "safevalues";
import {checkSanitizerInput} from "./internal/sanitize-input.js";

/** Fails on Edge, where neither supported sanitizer environment is available. */
export function sanitizeUserHtml(_dirty: string): SafeHtml {
  checkSanitizerInput(_dirty, arguments.length);
  throw new Error("sanitizeUserHtml requires a supported DOM or Node adapter; Edge sanitization is unsupported");
}
