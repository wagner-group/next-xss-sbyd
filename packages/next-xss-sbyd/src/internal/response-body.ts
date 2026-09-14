import {isHtml} from "safevalues";
import {InternalSafeNodeStream, InternalSafeStream, unwrapSafeStream} from "./stream.js";
import {unwrapHtml} from "./unwrap.js";

const AUTHENTICATOR_REGISTRY = Symbol.for("next-xss-sbyd.enforce.authenticators");
const SAFE_HTML_FIELD = "privateDoNotAccessOrElseWrappedHtml";
type AuthenticatedBody =
  | {body: string; kind: "html"}
  | {body: ReadableStream<Uint8Array>; kind: "stream"}
  | {body: InternalSafeNodeStream; kind: "node-stream"};
type BodyAuthenticator = (body: unknown) => AuthenticatedBody | null;

function authenticators(): BodyAuthenticator[] {
  const existing = Reflect.get(globalThis, AUTHENTICATOR_REGISTRY) as BodyAuthenticator[] | undefined;
  if (existing !== undefined) return existing;
  const registry: BodyAuthenticator[] = [];
  Object.defineProperty(globalThis, AUTHENTICATOR_REGISTRY, {configurable: false, value: registry});
  return registry;
}

function authenticateLocalBody(body: unknown): AuthenticatedBody | null {
  if (body instanceof InternalSafeNodeStream) return {body, kind: "node-stream"};
  if (body instanceof InternalSafeStream) return {body: unwrapSafeStream(body), kind: "stream"};
  if (isHtml(body)) return {body: unwrapHtml(body), kind: "html"};
  return null;
}

// Next.js can bundle another package copy alongside the preloaded guard. Each
// copy contributes its own brand checks. This registry trusts loaded server code;
// it is not an authority against deliberate in-process mutation.
authenticators().push(authenticateLocalBody);

/** Authenticates an object with a registered package copy, never a raw body. */
export function authenticateBody(body: unknown): AuthenticatedBody | null {
  // No registry entry can opt a primitive or empty body into the safe protocol.
  if (typeof body !== "object" || body === null) return null;
  for (const authenticate of authenticators()) {
    const authenticated = authenticate(body);
    if (authenticated !== null) return authenticated;
  }
  if (SAFE_HTML_FIELD in body) {
    throw new TypeError("Could not authenticate SafeHtml response body. The value may come from a duplicate physical copy of safevalues; use next-xss-sbyd builders and deduplicate safevalues dependencies.");
  }
  return null;
}

/** Recognizes safe-looking bodies so ordinary constructors can give API guidance. */
export function isRecognizableSafeBody(body: unknown): boolean {
  return body instanceof InternalSafeNodeStream || body instanceof InternalSafeStream || isHtml(body) ||
    (typeof body === "object" && body !== null && SAFE_HTML_FIELD in body);
}
