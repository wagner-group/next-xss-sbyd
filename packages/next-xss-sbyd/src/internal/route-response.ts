import {assertPassiveContentType} from "../passive-content.js";
import {HTML_CONTENT_TYPE} from "./response-policy.js";
import {hasSafeResponseBody, responseBody} from "./response-provenance.js";

const NativeResponse = Response;
/** Identifies a rejected outgoing response without confusing user handler errors. */
export class RouteResponseError extends TypeError {
  readonly code = "XSS_SBYD_UNSAFE_ROUTE_RESPONSE";

  /** Includes the diagnostic code in logs that print only the error message. */
  constructor(message: string) {
    super(`XSS_SBYD_UNSAFE_ROUTE_RESPONSE: ${message}`);
  }
}

/** Checks effective outgoing headers without reading or buffering the body. */
export function validateRouteResponse(value: unknown, subject = "Route handler"): Response {
  if (!(value instanceof NativeResponse)) throw new RouteResponseError(`${subject} must return a Response`);
  let body: ReadableStream | null;
  try { body = responseBody(value); }
  catch { throw new RouteResponseError(`${subject} must return a native Response`); }
  const headers = new Headers(value.headers);
  const contentType = headers.get("content-type");
  if (body !== null) {
    if (hasSafeResponseBody(body)) {
      if (contentType !== HTML_CONTENT_TYPE || headers.get("x-content-type-options") !== "nosniff") {
        throw new RouteResponseError(`${subject}: Safe HTML response requires fixed HTML security headers; received ${contentType ?? "no Content-Type"}`);
      }
    } else {
      try { assertPassiveContentType(contentType, subject); }
      catch (error) {
        throw new RouteResponseError((error as Error).message);
      }
    }
  }
  // Native network-error responses have no body and cannot be reconstructed.
  if (value.status === 0 && body === null) return value;
  headers.set("x-content-type-options", "nosniff");
  let result: Response;
  try { result = new NativeResponse(body, {status: value.status, statusText: value.statusText, headers}); }
  catch (error) { throw new RouteResponseError(`${subject}: ${(error as Error).message}`); }
  // Next's Edge adapter deletes internal headers after the handler returns.
  // Copying isolates the handler's original headers without freezing Next's copy.
  return result;
}
