import {headers as requestHeaders} from "next/headers.js";
import {NextRequest, NextResponse} from "next/server.js";

declare const cspNonceBrand: unique symbol;
export type CspNonce = string & {readonly [cspNonceBrand]: true};

export interface XssSbydCspOptions {
  readonly mode?: "enforce" | "report-only";
  readonly scriptSrc?: readonly string[];
  /** Trusted stylesheet sources. Style attributes are always allowed; this is not configurable. */
  readonly styleSrc?: readonly string[];
  readonly connectSrc?: readonly string[];
  readonly imgSrc?: readonly string[];
  readonly fontSrc?: readonly string[];
  readonly mediaSrc?: readonly string[];
  readonly frameSrc?: readonly string[];
  readonly formAction?: readonly string[];
  readonly reportUri?: string;
  readonly reportTo?: string;
}

export interface CspViolationReport {
  readonly blockedOrigin: string;
  readonly columnNumber?: number;
  readonly documentURL?: string;
  readonly disposition?: string;
  readonly lineNumber?: number;
  readonly originalPolicy?: string;
  readonly referrer?: string;
  readonly sample: string;
  readonly sourceFile?: string;
  readonly statusCode?: number;
  readonly violatedDirective: string;
}

export interface CspReportHandlerOptions {
  readonly log: (report: CspViolationReport) => void | Promise<void>;
  readonly maxBytes?: number;
  readonly maxReports?: number;
}

export interface CspPolicySuggestions {
  readonly options: Partial<XssSbydCspOptions>;
  readonly warnings: readonly string[];
}

export interface XssSbydRequest extends Request {
  readonly nextUrl: URL;
}

export type XssSbydHandler<RequestType extends XssSbydRequest = XssSbydRequest, EventType = unknown> = (
  request: RequestType,
  event: EventType,
) => Response | undefined | Promise<Response | undefined>;

const NONCE_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const SOURCE_PATTERN = /^[^\u0000-\u0020\u007f;,]+$/;
const REQUEST_CONTROL_HEADERS = new Set(["content-security-policy", "x-nonce"]);
const REPORT_CONTENT_TYPES = new Set(["application/csp-report", "application/reports+json"]);
const DEFAULT_REPORT_MAX_BYTES = 65_536;
const DEFAULT_REPORT_MAX_COUNT = 32;
const MAX_REPORT_SAMPLE_LENGTH = 256;
const REPORT_SAMPLE_CONTROLS = /[\u0000-\u0020\u007f]+/gu;
const REPORTING_GROUP = "next-xss-sbyd-csp";

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function reportString(record: Record<string, unknown>, ...names: string[]): string {
  for (const name of names) if (typeof record[name] === "string") return record[name];
  return "";
}

function blockedOrigin(value: string): string {
  if (value === "") return "";
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
    if (url.protocol === "data:" || url.protocol === "blob:") return url.protocol;
  } catch {
    // Browser report keywords are handled below.
  }
  if (/^[a-z][a-z0-9-]{0,63}$/u.test(value)) return value;
  return "unrecognized";
}

function safeDocumentURL(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? `${url.origin}${url.pathname}`.slice(0, 2048)
      : undefined;
  } catch {
    return undefined;
  }
}

function safeSourceFile(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return `${url.origin}${url.pathname}`.slice(0, 2048);
  } catch {
    return undefined;
  }
}

function normalizeReport(value: unknown): CspViolationReport | undefined {
  const record = plainRecord(value);
  if (record === undefined) return undefined;
  const violatedDirective = reportString(
    record,
    "effectiveDirective",
    "effective-directive",
    "violated-directive",
  ).trim().split(/\s+/u, 1)[0]?.toLowerCase() ?? "";
  const blocked = reportString(record, "blockedURL", "blocked-uri").trim();
  const origin = blockedOrigin(blocked);
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(violatedDirective) || origin === "") return undefined;
  const report: CspViolationReport = {
    blockedOrigin: origin,
    sample: reportString(record, "sample", "script-sample")
      .replace(REPORT_SAMPLE_CONTROLS, " ")
      .trim()
      .slice(0, MAX_REPORT_SAMPLE_LENGTH),
    violatedDirective,
  };
  const documentURL = safeDocumentURL(reportString(record, "documentURL", "document-uri"));
  const sourceFile = safeSourceFile(reportString(record, "sourceFile", "source-file"));
  const referrer = safeDocumentURL(reportString(record, "referrer"));
  const disposition = reportString(record, "disposition").trim().toLowerCase();
  const originalPolicy = reportString(record, "originalPolicy", "original-policy").slice(0, 4096);
  const statusCode = record.statusCode ?? record["status-code"];
  const lineNumber = record.lineNumber ?? record["line-number"];
  const columnNumber = record.columnNumber ?? record["column-number"];
  return {
    ...report,
    ...(documentURL === undefined ? {} : {documentURL}),
    ...(sourceFile === undefined ? {} : {sourceFile}),
    ...(referrer === undefined ? {} : {referrer}),
    ...(disposition === "enforce" || disposition === "report" ? {disposition} : {}),
    ...(originalPolicy === "" ? {} : {originalPolicy}),
    ...(typeof statusCode === "number" && Number.isInteger(statusCode) ? {statusCode} : {}),
    ...(typeof lineNumber === "number" && Number.isInteger(lineNumber) && lineNumber >= 0 ? {lineNumber} : {}),
    ...(typeof columnNumber === "number" && Number.isInteger(columnNumber) && columnNumber >= 0 ? {columnNumber} : {}),
  };
}

async function readLimitedBody(request: Request, maxBytes: number): Promise<{body?: string; tooLarge: boolean}> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxBytes) {
    return {tooLarge: true};
  }
  if (request.body === null) return {body: "", tooLarge: false};
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", {fatal: true});
  let size = 0;
  let body = "";
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return {tooLarge: true};
      }
      body += decoder.decode(value, {stream: true});
    }
    return {body: body + decoder.decode(), tooLarge: false};
  } catch {
    return {tooLarge: false};
  }
}

function responseWithStatus(status: number, message: string, headers?: HeadersInit): Response {
  return new Response(message, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

/** Creates a bounded route handler for legacy and Reporting API CSP violation reports. */
export function createCspReportHandler(options: CspReportHandlerOptions): (request: Request) => Promise<Response> {
  if (typeof options?.log !== "function") throw new TypeError("CSP report handler requires a log callback");
  const maxBytes = options.maxBytes ?? DEFAULT_REPORT_MAX_BYTES;
  const maxReports = options.maxReports ?? DEFAULT_REPORT_MAX_COUNT;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new TypeError("CSP report maxBytes must be a positive integer");
  if (!Number.isSafeInteger(maxReports) || maxReports <= 0) throw new TypeError("CSP report maxReports must be a positive integer");

  return async (request) => {
    if (request.method !== "POST") return responseWithStatus(405, "Method not allowed", {allow: "POST"});
    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (!REPORT_CONTENT_TYPES.has(contentType)) return responseWithStatus(415, "Unsupported CSP report content type");
    const result = await readLimitedBody(request, maxBytes);
    if (result.tooLarge) return responseWithStatus(413, "CSP report too large");
    if (result.body === undefined) return responseWithStatus(400, "Invalid CSP report");
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.body);
    } catch {
      return responseWithStatus(400, "Invalid CSP report");
    }

    let candidates: unknown[];
    if (contentType === "application/csp-report") {
      const envelope = plainRecord(parsed);
      // WebKit also sends a named Reporting API envelope with this legacy MIME type.
      const candidate = envelope && Object.hasOwn(envelope, "csp-report")
        ? envelope["csp-report"]
        : envelope?.type === "csp-violation" ? envelope.body : undefined;
      candidates = [candidate];
    } else {
      if (!Array.isArray(parsed)) return responseWithStatus(400, "Invalid CSP report");
      candidates = parsed.flatMap((entry) => {
        const envelope = plainRecord(entry);
        return envelope?.type === "csp-violation" ? [envelope.body] : [];
      });
    }
    if (candidates.length === 0) return responseWithStatus(400, "No CSP violation reports");
    const seen = new Map<string, CspViolationReport>();
    for (const candidate of candidates) {
      const report = normalizeReport(candidate);
      if (report === undefined) return responseWithStatus(400, "Invalid CSP violation report");
      const key = JSON.stringify(report);
      seen.set(key, report);
    }
    if (seen.size > maxReports) return responseWithStatus(413, "Too many CSP violation reports");
    await Promise.all([...seen.values()].map(options.log));
    return new Response(null, {status: 204, headers: {"cache-control": "no-store"}});
  };
}

const DIRECTIVE_OPTION = {
  "connect-src": "connectSrc",
  "font-src": "fontSrc",
  "form-action": "formAction",
  "frame-src": "frameSrc",
  "img-src": "imgSrc",
  "media-src": "mediaSrc",
  "script-src": "scriptSrc",
  "style-src": "styleSrc",
} as const;

const DEFAULT_DIRECTIVE_SOURCES: Readonly<Record<keyof typeof DIRECTIVE_OPTION, readonly string[]>> = {
  "connect-src": ["'self'"],
  "font-src": ["'self'"],
  "form-action": ["'self'"],
  "frame-src": ["'none'"],
  "img-src": ["'self'"],
  "media-src": ["'self'"],
  "script-src": ["'self'"],
  "style-src": ["'self'"],
};

function isExactHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:")
      && url.username === ""
      && url.password === ""
      && url.origin === value;
  } catch {
    return false;
  }
}

/** Aggregates normalized reports into a conservative CSP option delta and review warnings. */
export function reportsToCspOptions(reports: readonly CspViolationReport[]): CspPolicySuggestions {
  const additions = new Map<keyof typeof DIRECTIVE_OPTION, Set<string>>();
  const warnings: string[] = [];
  const warningSet = new Set<string>();
  function warn(message: string): void {
    if (!warningSet.has(message)) {
      warningSet.add(message);
      warnings.push(message);
    }
  }
  for (const report of reports) {
    if (typeof report?.violatedDirective !== "string" || typeof report.blockedOrigin !== "string") continue;
    const directive = report.violatedDirective.replace(/-(?:elem|attr)$/u, "") as keyof typeof DIRECTIVE_OPTION;
    if (!Object.hasOwn(DIRECTIVE_OPTION, directive)) {
      warn(`${directive} has no configurable xss-sbyd option; investigate this violation manually`);
      continue;
    }
    const source = report.blockedOrigin;
    if (directive === "style-src" && source === "inline") {
      if (report.violatedDirective === "style-src-attr") {
        warn("style-src-attr reported a blocked attribute, but the package policy already allows style attributes; check for an additional or outdated CSP policy, or a cached response");
      } else if (report.violatedDirective === "style-src-elem") {
        warn("style-src-elem blocked an inline stylesheet element; use a bundled stylesheet or SafeStyleBlock with literal-only safeStyleSheet and the current document nonce; do not add 'unsafe-inline'");
      } else {
        warn("style-src blocked inline content; check for an additional or outdated CSP policy, or a cached response; use the current document nonce for eligible stylesheet elements; do not add 'unsafe-inline' to styleSrc");
      }
      continue;
    }
    if (source === "inline" || source === "eval") {
      warn(`${directive} blocked ${source} content; do not add '${source === "inline" ? "unsafe-inline" : "unsafe-eval"}'`);
      continue;
    }
    if (directive === "script-src") {
      warn(`script-src blocked ${source}; strict-dynamic ignores host allowlists, so fix nonce propagation instead`);
      continue;
    }
    if (directive === "form-action") {
      warn(`form-action blocked ${source}; review this submission destination manually`);
      continue;
    }
    if (directive === "frame-src") {
      warn(`frame-src blocked ${source}; review the framed origin and sandbox policy manually`);
      continue;
    }
    const broad = source === "*" || /^(?:https?|data|blob):$/u.test(source);
    const passiveScheme = (directive === "img-src" || directive === "media-src") && /^(?:data|blob):$/u.test(source);
    if (broad && !passiveScheme) {
      const qualifier = /^(?:data|blob):$/u.test(source) ? "dangerous" : "broad";
      warn(`${directive} proposed ${qualifier} source ${source}; add an exact trusted origin instead`);
      continue;
    }
    if (!isExactHttpOrigin(source) && !passiveScheme) {
      warn(`${directive} reported ${source}; no safe automatic policy suggestion is available`);
      continue;
    }
    const sources = additions.get(directive) ?? new Set<string>();
    sources.add(source);
    additions.set(directive, sources);
  }
  const options: Record<string, readonly string[]> = {};
  for (const directive of Object.keys(DIRECTIVE_OPTION).sort() as (keyof typeof DIRECTIVE_OPTION)[]) {
    const sources = additions.get(directive);
    if (sources !== undefined) {
      options[DIRECTIVE_OPTION[directive]] = [...new Set([...DEFAULT_DIRECTIVE_SOURCES[directive], ...sources])].sort();
    }
  }
  return {options, warnings};
}
function validateSources(name: keyof typeof DIRECTIVE_OPTION, values: readonly string[]): readonly string[] {
  for (const value of values) {
    if (!SOURCE_PATTERN.test(value)) throw new TypeError(`Invalid CSP ${name} source: ${JSON.stringify(value)}`);
    if (/^'unsafe-(?:inline|eval|hashes)'$/iu.test(value)) {
      throw new TypeError(`Unsafe CSP ${DIRECTIVE_OPTION[name]} (${name}) source: ${JSON.stringify(value)}; remove this broad allowance and use trusted sources or nonces on eligible elements`);
    }
  }
  return values;
}

function createNonce(): CspNonce {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "") as CspNonce;
}

function directive(name: string, sources: readonly string[]): string {
  return `${name} ${sources.join(" ")}`;
}

/** Builds the strict per-request CSP used by xss-sbyd middleware. */
export function createContentSecurityPolicy(nonce: CspNonce, options: XssSbydCspOptions = {}): string {
  if (!NONCE_PATTERN.test(nonce)) throw new TypeError("Invalid CSP nonce");
  const script = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...validateSources("script-src", options.scriptSrc ?? [])];
  // Next.js tooling needs eval in development; caller sources never receive this exception.
  if (process.env.NODE_ENV === "development") script.push("'unsafe-eval'");
  const styleSources = validateSources("style-src", options.styleSrc ?? []);
  const directives = [
    "default-src 'self'",
    directive("script-src", script),
    directive("style-src", ["'self'", "'unsafe-inline'", ...styleSources]),
    directive("style-src-elem", ["'self'", `'nonce-${nonce}'`, ...styleSources]),
    "style-src-attr 'unsafe-inline'",
    directive("connect-src", validateSources("connect-src", options.connectSrc ?? ["'self'"])),
    directive("img-src", validateSources("img-src", options.imgSrc ?? ["'self'"])),
    directive("font-src", validateSources("font-src", options.fontSrc ?? ["'self'"])),
    directive("media-src", validateSources("media-src", options.mediaSrc ?? ["'self'"])),
    directive("frame-src", validateSources("frame-src", options.frameSrc ?? ["'none'"])),
    "object-src 'none'",
    "base-uri 'self'",
    directive("form-action", validateSources("form-action", options.formAction ?? ["'self'"])),
    "frame-ancestors 'none'",
  ];
  if (options.reportUri !== undefined) {
    if (!options.reportUri.startsWith("/") || options.reportUri.startsWith("//") || options.reportUri.includes("\\") || !SOURCE_PATTERN.test(options.reportUri)) {
      throw new TypeError(`Invalid CSP report URI: ${JSON.stringify(options.reportUri)}`);
    }
    directives.push(`report-uri ${options.reportUri}`);
    if (options.mode === "report-only" && options.reportTo === undefined) directives.push(`report-to ${REPORTING_GROUP}`);
  }
  if (options.reportTo !== undefined) {
    if (!options.reportTo.startsWith("/") || options.reportTo.startsWith("//") || options.reportTo.includes("\\") || !SOURCE_PATTERN.test(options.reportTo)) {
      throw new TypeError(`Invalid CSP Reporting API endpoint: ${JSON.stringify(options.reportTo)}`);
    }
    directives.push("report-to xss-sbyd");
  }
  return directives.join("; ");
}

function readInnerForwardedHeaders(response: Response, fallback: Headers): Headers {
  const names = response.headers.get("x-middleware-override-headers");
  if (names === null) return fallback;
  const merged = new Headers();
  for (const name of names.split(",").map((value) => value.trim()).filter(Boolean)) {
    const value = response.headers.get(`x-middleware-request-${name}`);
    if (value === null) merged.delete(name);
    else merged.set(name, value);
  }
  return merged;
}

function applyForwardedHeaders(response: Response, forwarded: Headers): void {
  const carrier = NextResponse.next({request: {headers: forwarded}});
  for (const [name, value] of carrier.headers) {
    if (name === "x-middleware-override-headers" || name.startsWith("x-middleware-request-")) {
      response.headers.set(name, value);
    }
  }
}

function applyResponseHeaders(
  response: Response,
  policy: string,
  mode: "enforce" | "report-only",
  reportUri: string | undefined,
  reportTo: string | undefined,
  requestUrl: string,
): void {
  const cspName = mode === "report-only" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";
  if (mode === "enforce") response.headers.delete("Content-Security-Policy-Report-Only");
  response.headers.set(cspName, policy);
  const endpointPath = reportTo ?? (mode === "report-only" ? reportUri : undefined);
  if (endpointPath !== undefined) {
    const group = reportTo === undefined ? REPORTING_GROUP : "xss-sbyd";
    const request = new URL(requestUrl);
    const resolvedEndpoint = new URL(endpointPath, request);
    if (resolvedEndpoint.origin !== request.origin) throw new TypeError("CSP reporting endpoint must remain on the request origin");
    const endpoint = `${group}=${JSON.stringify(resolvedEndpoint.href)}`;
    const existing = response.headers.get("Reporting-Endpoints");
    response.headers.set("Reporting-Endpoints", existing === null ? endpoint : `${existing}, ${endpoint}`);
  }
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
}

function mutableResponse(response: Response): Response {
  try {
    response.headers.delete("x-xss-sbyd-header-mutability-probe");
    return response;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }

  if (response.status !== 0) {
    return new Response(response.body, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  }

  // The Fetch constructor rejects status 0, which is used by Response.error().
  // Preserve that response's internal state and expose an independent mutable header list.
  const clone = response.clone();
  Object.defineProperty(clone, "headers", {value: new Headers(response.headers)});
  return clone;
}

/** Wraps existing middleware/proxy as the outer handler and preserves its response behavior. */
export function withXssSbydHeaders<RequestType extends XssSbydRequest, EventType>(
  inner: XssSbydHandler<RequestType, EventType>,
  options: XssSbydCspOptions = {},
): XssSbydHandler<RequestType, EventType> {
  return async (request, event) => {
    const nonce = createNonce();
    const policy = createContentSecurityPolicy(nonce, options);
    const forwarded = new Headers(request.headers);
    forwarded.set("x-nonce", nonce);
    forwarded.set("content-security-policy", policy);
    const augmentedRequest = new NextRequest(request, {headers: forwarded});
    const innerResponse = (await inner(augmentedRequest as unknown as RequestType, event)) ?? NextResponse.next();
    const response = mutableResponse(innerResponse);
    const merged = readInnerForwardedHeaders(response, forwarded);
    for (const name of REQUEST_CONTROL_HEADERS) merged.set(name, forwarded.get(name) ?? "");
    applyForwardedHeaders(response, merged);
    applyResponseHeaders(response, policy, options.mode ?? "enforce", options.reportUri, options.reportTo, request.url);
    return response;
  };
}

/** Creates standalone xss-sbyd middleware/proxy. */
export function createXssSbydHandler(options: XssSbydCspOptions = {}): XssSbydHandler {
  return withXssSbydHeaders(() => NextResponse.next(), options);
}

/** Reads and validates the nonce installed on the current request by xss-sbyd middleware. */
export async function getNonce(): Promise<CspNonce> {
  const nonce = (await requestHeaders()).get("x-nonce");
  if (nonce === null || !NONCE_PATTERN.test(nonce)) {
    throw new TypeError("A valid xss-sbyd CSP nonce is unavailable; ensure the middleware/proxy matcher covers this route");
  }
  return nonce as CspNonce;
}
