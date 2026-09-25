import {trustedResourceUrl as safeValuesTrustedResourceUrl} from "safevalues";
import type {TrustedResourceUrl as SafeValuesTrustedResourceUrl} from "safevalues";

/** A URL trusted to serve JavaScript that may execute in the application. */
export type TrustedScriptUrl = SafeValuesTrustedResourceUrl;

/** Constructs a trusted script URL from a developer-reviewed template literal. */
export const trustedScriptUrl = safeValuesTrustedResourceUrl;
