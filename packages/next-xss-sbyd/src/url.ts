import {sanitizeUrl} from "@braintree/sanitize-url";

declare const navigationUrlBrand: unique symbol;
declare const resourceUrlBrand: unique symbol;
declare const formActionUrlBrand: unique symbol;
declare const pathSegmentBrand: unique symbol;
declare const queryValueBrand: unique symbol;

export type SafeNavigationUrl = string & {readonly [navigationUrlBrand]: true};
export type SafeResourceUrl = string & {readonly [resourceUrlBrand]: true};
export type SafeFormActionUrl = string & {readonly [formActionUrlBrand]: true};
export type PathSegment = string & {readonly [pathSegmentBrand]: true};
export type QueryValue = string & {readonly [queryValueBrand]: true};

const PARSE_BASE = "https://next-xss-sbyd.invalid/";
const PARSE_ORIGIN = new URL(PARSE_BASE).origin;
const FORBIDDEN_CHARACTERS = /[\u0000-\u0020\u007f\\]/;

class InvalidUrlError extends TypeError {}

function invalid(kind: string, value: string): Error {
  return new InvalidUrlError(`Invalid ${kind}: ${JSON.stringify(value)}`);
}

function buildOrNull<T extends string>(build: (value: string) => T, value: string): T | null {
  try {
    return build(value);
  } catch (error) {
    if (!(error instanceof InvalidUrlError)) throw error;
    return null;
  }
}

function parseHttpUrl(value: string, kind: string): URL {
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

function validateNavigationScheme(parsed: URL, value: string, kind: string): void {
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

/** Validates and canonicalizes a URL used for user navigation. */
export function navigationUrl(value: string): SafeNavigationUrl {
  const kind = "navigation URL";
  const parsed = parseHttpUrl(value, kind);
  let result: string;
  if (parsed.origin === PARSE_ORIGIN) {
    result = canonicalRelative(parsed, value, kind);
  } else if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    result = parsed.href;
  } else if (parsed.protocol === "mailto:" || parsed.protocol === "tel:") {
    if (!value.toLowerCase().startsWith(parsed.protocol) || parsed.pathname === "") {
      throw invalid(kind, value);
    }
    validateNavigationScheme(parsed, value, kind);
    result = parsed.href;
  } else {
    throw invalid(kind, value);
  }
  return result as SafeNavigationUrl;
}

/** Returns a safe navigation URL, or `null` when validation fails. */
export function navigationUrlOrNull(value: string): SafeNavigationUrl | null {
  return buildOrNull(navigationUrl, value);
}

/** Validates and canonicalizes a URL used for passive resource loading. */
export function resourceUrl(value: string): SafeResourceUrl {
  const kind = "resource URL";
  const parsed = parseHttpUrl(value, kind);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw invalid(kind, value);
  const result = parsed.origin === PARSE_ORIGIN
    ? canonicalRelative(parsed, value, kind)
    : parsed.href;
  return result as SafeResourceUrl;
}

/** Returns a safe passive-resource URL, or `null` when validation fails. */
export function resourceUrlOrNull(value: string): SafeResourceUrl | null {
  return buildOrNull(resourceUrl, value);
}

/** Validates a same-origin, root-relative form submission target. */
export function formActionUrl(value: string): SafeFormActionUrl {
  const kind = "form action URL";
  const parsed = parseHttpUrl(value, kind);
  return canonicalRelative(parsed, value, kind) as SafeFormActionUrl;
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

/** Builds a navigation URL with an encoded dynamic path segment. */
export function relativePath(base: string, segment: PathSegment): SafeNavigationUrl {
  return navigationUrl(joinPath(base, segment, ""));
}

/** Builds a passive-resource URL with an encoded path segment and literal suffix. */
export function relativeResourcePath(base: string, segment: PathSegment, suffix = ""): SafeResourceUrl {
  if (suffix !== "" && !/^\.[A-Za-z0-9._-]+$/.test(suffix)) {
    throw invalid("resource path suffix", suffix);
  }
  return resourceUrl(joinPath(base, segment, suffix));
}

/** Replaces the query string on a safe navigation URL using encoded values. */
export function withQuery(
  url: SafeNavigationUrl,
  values: Readonly<Record<string, QueryValue>>,
): SafeNavigationUrl {
  const parsed = new URL(url, PARSE_BASE);
  parsed.search = new URLSearchParams(values).toString();
  const candidate = parsed.origin === PARSE_ORIGIN
    ? `${parsed.pathname}${parsed.search}${parsed.hash}`
    : parsed.href;
  return navigationUrl(candidate);
}
