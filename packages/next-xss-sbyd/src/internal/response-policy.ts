// Versioned, process-wide protocol identities let Next.js bundles cooperate with
// a preloaded guard. These markers select body authentication, never bypass it.
// Body brands remain copy-local and are checked by registered authenticators.
export const GUARDED_RESPONSE = Symbol.for("next-xss-sbyd.enforce.class.v1");
export const SAFE_RESPONSE_CONSTRUCTOR = Symbol.for("next-xss-sbyd.response.safe-constructor.v1");
export const SAFE_NODE_STREAM_SINK = Symbol.for("next-xss-sbyd.response.safe-node-stream-sink.v1");

export const HTML_CONTENT_TYPE = "text/html; charset=utf-8";
const FORBIDDEN_HEADERS = new Set(["content-type", "x-content-type-options"]);

/** Builds the fixed headers for authenticated HTML without mutating caller input. */
export function secureHtmlHeaders(input?: HeadersInit): Headers {
  const headers = new Headers(input);
  for (const name of FORBIDDEN_HEADERS) {
    if (headers.has(name)) throw new TypeError(`Safe HTML response security header ${name} cannot be overridden`);
  }
  headers.set("Content-Type", HTML_CONTENT_TYPE);
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}
