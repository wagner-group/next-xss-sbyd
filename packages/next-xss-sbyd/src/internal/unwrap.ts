import type {TrustedScriptUrl} from "../trusted-script-url.js";
import {
  unwrapHtml as unwrapSafeValuesHtml,
  unwrapResourceUrl as unwrapSafeValuesResourceUrl,
  unwrapScript as unwrapSafeValuesScript,
  unwrapStyleSheet as unwrapSafeValuesStyleSheet,
} from "safevalues";
import type {SafeHtml, SafeScript, SafeStyleSheet} from "safevalues";

function duplicateCopyError(type: string, cause: unknown): TypeError {
  return new TypeError(
    `Could not unwrap ${type}. The value may come from a duplicate physical copy of safevalues. ` +
      "Create values with builders exported by next-xss-sbyd and deduplicate safevalues dependencies.",
    {cause},
  );
}

/** Unwraps SafeHtml with this package's SafeValues copy or fails closed. */
export function unwrapHtml(value: SafeHtml): string {
  try { return String(unwrapSafeValuesHtml(value)); } catch (error) { throw duplicateCopyError("SafeHtml", error); }
}

/** Unwraps SafeScript with this package's SafeValues copy or fails closed. */
export function unwrapScript(value: SafeScript): string {
  try { return String(unwrapSafeValuesScript(value)); } catch (error) { throw duplicateCopyError("SafeScript", error); }
}

/** Unwraps SafeStyleSheet with this package's SafeValues copy or fails closed. */
export function unwrapStyleSheet(value: SafeStyleSheet): string {
  try { return unwrapSafeValuesStyleSheet(value); } catch (error) { throw duplicateCopyError("SafeStyleSheet", error); }
}

/** Unwraps TrustedScriptUrl with this package's SafeValues copy or fails closed. */
export function unwrapResourceUrl(value: TrustedScriptUrl): string {
  try { return String(unwrapSafeValuesResourceUrl(value)); } catch (error) { throw duplicateCopyError("TrustedScriptUrl", error); }
}
