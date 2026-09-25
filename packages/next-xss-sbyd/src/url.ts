import {sanitizeUrl} from "@braintree/sanitize-url";

declare const pathSegmentBrand: unique symbol;
declare const queryValueBrand: unique symbol;

export type PathSegment = string & {readonly [pathSegmentBrand]: true};
export type QueryValue = string & {readonly [queryValueBrand]: true};

const PARSE_BASE = "https://next-xss-sbyd.invalid/";
const PARSE_ORIGIN = new URL(PARSE_BASE).origin;
const FORBIDDEN_CHARACTERS = /[\u0000-\u0020\u007f\\]/;

class InvalidUrlError extends TypeError {}

function invalid(kind: string, value: string): Error {
  return new InvalidUrlError(`Invalid ${kind}: ${JSON.stringify(value)}`);
}

function parseUrl(value: string, kind: string): URL {
  if (value === "" || FORBIDDEN_CHARACTERS.test(value) || value.startsWith("//")) {
    throw invalid(kind, value);
  }
  if (sanitizeUrl(value) === "about:blank") throw invalid(kind, value);
  let parsed: URL;
  try {
    parsed = new URL(value, PARSE_BASE);
  } catch {
    throw invalid(kind, value);
  }
  if (parsed.username !== "" || parsed.password !== "") throw invalid(kind, value);
  return parsed;
}

function canonicalRelative(parsed: URL, original: string, kind: string): string {
  if (!original.startsWith("/") || parsed.origin !== PARSE_ORIGIN) throw invalid(kind, original);
  const result = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (result.startsWith("//")) throw invalid(kind, original);
  return result;
}

function validateContactScheme(parsed: URL, value: string, kind: string): void {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw invalid(kind, value);
  }
  if (FORBIDDEN_CHARACTERS.test(decoded)) throw invalid(kind, value);
  if (parsed.protocol === "mailto:") {
    if (parsed.pathname === "" || value.slice("mailto:".length).startsWith("//")) throw invalid(kind, value);
    return;
  }
  if (!/^\+?[0-9().-]+(?:;[A-Za-z0-9.-]+=[A-Za-z0-9.-]+)*$/.test(parsed.pathname)) {
    throw invalid(kind, value);
  }
}

/**
 * Validates and canonicalizes a passive URL as an ordinary string.
 * Accepts root-relative paths, HTTP(S), mailto, and tel URLs; throws on invalid input.
 * This checks URL syntax and schemes, not destination trust or permission to load code.
 */
export function validateUrl(value: string): string {
  const kind = "URL";
  const parsed = parseUrl(value, kind);
  let result: string;
  if (parsed.origin === PARSE_ORIGIN) {
    result = canonicalRelative(parsed, value, kind);
  } else if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    result = parsed.href;
  } else if (parsed.protocol === "mailto:" || parsed.protocol === "tel:") {
    if (!value.toLowerCase().startsWith(parsed.protocol) || parsed.pathname === "") {
      throw invalid(kind, value);
    }
    validateContactScheme(parsed, value, kind);
    result = parsed.href;
  } else {
    throw invalid(kind, value);
  }
  return result;
}

/** Returns a canonical URL, or `null` for invalid URL strings; caller type errors still throw. */
export function validateUrlOrNull(value: string): string | null {
  try {
    return validateUrl(value);
  } catch (error) {
    if (!(error instanceof InvalidUrlError)) throw error;
    return null;
  }
}

/** Encodes untrusted text as one opaque URL path segment. */
export function pathSegment(value: string): PathSegment {
  const encoded = encodeURIComponent(value);
  if (encoded === "." || encoded === "..") throw invalid("path segment", value);
  return encoded as PathSegment;
}

/** Marks untrusted text for encoding by `withQuery`. */
export function queryValue(value: string): QueryValue {
  return value as QueryValue;
}

function joinPath(base: string, segment: PathSegment, suffix: string): string {
  if (!base.startsWith("/") || base.startsWith("//") || FORBIDDEN_CHARACTERS.test(base) || /[?#]/.test(base)) {
    throw invalid("root-relative base path", base);
  }
  const separator = base.endsWith("/") ? "" : "/";
  return `${base}${separator}${segment}${suffix}`;
}

/** Builds a root-relative URL with an encoded dynamic path segment. */
export function relativePath(base: string, segment: PathSegment): string {
  return validateUrl(joinPath(base, segment, ""));
}

/** Builds a passive-resource URL with an encoded path segment and literal suffix. */
export function relativeResourcePath(base: string, segment: PathSegment, suffix = ""): string {
  if (suffix !== "" && !/^\.[A-Za-z0-9._-]+$/.test(suffix)) {
    throw invalid("resource path suffix", suffix);
  }
  return validateUrl(joinPath(base, segment, suffix));
}

/** Validates a URL and replaces its query string using encoded values. */
export function withQuery(
  url: string,
  values: Readonly<Record<string, QueryValue>>,
): string {
  const parsed = new URL(validateUrl(url), PARSE_BASE);
  parsed.search = new URLSearchParams(values).toString();
  const candidate = parsed.origin === PARSE_ORIGIN
    ? `${parsed.pathname}${parsed.search}${parsed.hash}`
    : parsed.href;
  return validateUrl(candidate);
}
