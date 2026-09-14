import {JSDOM} from "jsdom";
import type {SafeHtml} from "safevalues";
import {createSanitizer, sanitizeWith} from "./internal/sanitize.js";
import {checkSanitizerInput} from "./internal/sanitize-input.js";
import {checkSanitizerDepth} from "./internal/sanitize-depth.js";

const privatePurifier = createSanitizer(new JSDOM("<!doctype html>").window);

/** Sanitizes untrusted HTML using the fixed formatting, image, and media rules in Node. */
export function sanitizeUserHtml(dirty: string): SafeHtml {
  checkSanitizerInput(dirty, arguments.length);
  checkSanitizerDepth(dirty);
  return sanitizeWith(privatePurifier, dirty);
}
