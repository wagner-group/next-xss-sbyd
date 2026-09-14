import {assertPassiveContentType} from "./passive-content.js";

const OriginalResponse = Response;
declare const passiveResponseBrand: unique symbol;

/** A response checked by passiveResponse; subsequent header changes require revalidation. */
export interface PassiveResponse extends Response {
  readonly [passiveResponseBrand]: true;
}

/**
 * Prepares native fetch output for a route return, rejecting 3xx statuses and
 * active or unknown media types. Forwards only content and cache metadata, never
 * upstream cookies, CORS, navigation, security-policy or hop-by-hop headers.
 * Call at the return boundary; later header changes invalidate this check.
 * HTML must instead be authenticated and passed to SafeResponse.
 */
export function passiveResponse(response: Response): PassiveResponse {
  if (response.status >= 300 && response.status < 400) {
    throw new TypeError("Upstream response must not have a 3xx status");
  }
  assertPassiveContentType(response.headers.get("content-type"), "Upstream response");
  const headers = new Headers();
  for (const name of ["content-type", "content-disposition", "cache-control", "etag",
    "last-modified", "vary", "expires", "content-language", "accept-ranges", "content-range"]) {
    const value = response.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set("X-Content-Type-Options", "nosniff");
  // Native fetch decodes the body but retains the upstream encoding and length.
  // Preserve length only when no content coding changed the wire bytes.
  const length = response.headers.get("content-length");
  if (!response.headers.has("content-encoding") && length !== null) headers.set("content-length", length);
  return new OriginalResponse(response.body, {status: response.status, headers}) as PassiveResponse;
}

