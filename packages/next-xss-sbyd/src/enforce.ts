import {registerSafeResponse} from "./internal/response-provenance.js";
import {assertPassiveContentType} from "./passive-content.js";
export {withSafeRouteHandler} from "./route-handler.js";
import type {ServerResponse} from "node:http";
import type {Http2ServerResponse} from "node:http2";
import {pipeNodeStream} from "./internal/node-stream-sink.js";
import type {NextApiRequest, NextApiResponse} from "next";
import type {SafeHtml} from "safevalues";
import {htmlEscape} from "safevalues";
import {GUARDED_RESPONSE, HTML_CONTENT_TYPE, SAFE_NODE_STREAM_SINK, SAFE_RESPONSE_CONSTRUCTOR, secureHtmlHeaders} from "./internal/response-policy.js";
import {authenticateBody, isRecognizableSafeBody} from "./internal/response-body.js";

const INSTALLATION_MARKER = Symbol.for("next-xss-sbyd.enforce.installed");

const OriginalResponse = globalThis.Response;

type ResponseConstructor = typeof Response;
type NodeResponse = ServerResponse | Http2ServerResponse;
type EnforcedApiResponse = NodeResponse & {send?: (body: unknown) => unknown};

interface SafeApiMethods {
  /** Authenticates HTML and sends it with Next's send semantics, or Node end. */
  safeSend(html: SafeHtml): void;
  /** Ends with authenticated UTF-8 HTML, preserving Node's completion callback. */
  safeEnd(html: SafeHtml, callback?: () => void): this;
}

type SafeChain<Response extends NodeResponse, Key extends PropertyKey> =
  Response extends Record<Key, (...args: infer Args) => unknown>
    ? {[Method in Key]: (...args: Args) => SafeApiResponse<Response>}
    : unknown;

/** The response view installed by withSafeApiRoute; preserves custom fields and chaining. */
export type SafeApiResponse<Response extends NodeResponse = NextApiResponse> =
  SafeApiMethods &
  SafeChain<Response, "status"> &
  SafeChain<Response, "setDraftMode"> &
  SafeChain<Response, "setPreviewData"> &
  SafeChain<Response, "clearPreviewData"> &
  (Response extends {redirect: NextApiResponse["redirect"]} ? {
    /** Redirects using Next's URL overload while retaining the augmented response type. */
    redirect(url: string): SafeApiResponse<Response>;
    /** Redirects with an explicit status; the redirect ends the response. */
    redirect(status: number, url: string): SafeApiResponse<Response>;
  } : unknown) &
  Response;

type ApiHandler<Request, Response, Result> = (request: Request, response: Response) => Result;
const WRAPPED_RESPONSES = Symbol.for("next-xss-sbyd.enforce.api-responses.v1");

/** Shares installation ownership when a preloaded guard and bundled handler compose. */
function installedApiResponses(): WeakSet<NodeResponse> {
  const existing = Reflect.get(globalThis, WRAPPED_RESPONSES) as WeakSet<NodeResponse> | undefined;
  if (existing !== undefined) return existing;
  const responses = new WeakSet<NodeResponse>();
  Object.defineProperty(globalThis, WRAPPED_RESPONSES, {value: responses});
  return responses;
}

const wrappedResponses = installedApiResponses();

declare global {
  // Edge runtimes expose this global. Its value is deliberately irrelevant.
  // eslint-disable-next-line no-var
  var EdgeRuntime: string | undefined;
}

export {passiveResponse, type PassiveResponse} from "./passive-response.js";

function currentHeader(response: EnforcedApiResponse, name: string): string | undefined {
  const value = response.getHeader(name);
  return Array.isArray(value) ? value.join(", ") : value?.toString();
}

function setSafeHeaders(response: EnforcedApiResponse): void {
  if (response.getHeader("content-type") !== undefined) {
    throw new TypeError("Safe HTML response security header content-type cannot be overridden");
  }
  const contentTypeOptions = currentHeader(response, "x-content-type-options");
  if (contentTypeOptions !== undefined && contentTypeOptions.toLowerCase() !== "nosniff") {
    throw new TypeError("Safe HTML response security header x-content-type-options cannot be overridden");
  }
  response.setHeader("Content-Type", HTML_CONTENT_TYPE);
  response.setHeader("X-Content-Type-Options", "nosniff");
}

/** Adds explicit HTML sinks and guards ordinary methods until the response finishes or closes. */
export function withSafeApiRoute<Request = NextApiRequest, Response extends NodeResponse = NextApiResponse, Result = unknown>(
  handler: ApiHandler<Request, SafeApiResponse<Response>, Result>,
): ApiHandler<Request, Response, Result> {
  return function safeApiRoute(request, rawResponse) {
    const response = rawResponse as EnforcedApiResponse;
    // HOCs and bundled package copies reuse the outer invocation's cleanup.
    if (wrappedResponses.has(response)) return handler(request, response as unknown as SafeApiResponse<Response>);
    const methods = ["send", "end", "write", "writeHead", "redirect", "safeSend", "safeEnd", SAFE_NODE_STREAM_SINK] as const;
    const originals = methods.map((name) => Object.getOwnPropertyDescriptor(response, name));
    const originalSend = response.send?.bind(response);
    const originalRedirect: unknown = Reflect.get(response, "redirect");
    const originalEnd = response.end.bind(response);
    const originalWrite = response.write.bind(response);
    const originalWriteHead = response.writeHead.bind(response);
    let committedContentType: string | undefined;
    let delegating = false;
    let restored = false;

    function restore(): void {
      if (restored) return;
      restored = true;
      wrappedResponses.delete(response);
      response.removeListener("finish", restore);
      response.removeListener("close", restore);
      for (const [index, name] of methods.entries()) {
        const descriptor = originals[index];
        if (descriptor) Object.defineProperty(response, name, descriptor);
        else Reflect.deleteProperty(response, name);
      }
    }

    function enforce(
      body: unknown,
      trailingArguments: unknown[],
      delegate: (value: unknown, ...rest: unknown[]) => unknown,
      inferContentType = false,
    ): unknown {
      if (!delegating) {
        if (isRecognizableSafeBody(body) || authenticateBody(body) !== null) {
          throw new TypeError("SafeHtml must be passed to response.safeSend() or response.safeEnd(); use safePipe() for SafeNodeStream and SafeResponse for SafeStream, not send(), end(), or write()");
        }
        const contentType = response.headersSent ? committedContentType : currentHeader(response, "content-type");
        if (typeof body === "string" && body.length > 0) assertPassiveContentType(contentType);
        // Next's send(Buffer) chooses application/octet-stream before calling
        // end(). Enforce bytes there, after inference and before the actual write.
        if (!inferContentType && ArrayBuffer.isView(body) && body.byteLength > 0) {
          assertPassiveContentType(contentType, "Raw byte response");
        }
      }
      return delegate(body, ...trailingArguments);
    }

    function deliver(html: SafeHtml, send: boolean, callback?: () => void): void {
      const authenticated = authenticateBody(html);
      if (authenticated?.kind !== "html") throw new TypeError("response.safeSend() and response.safeEnd() require an authenticated SafeHtml body");
      if (callback !== undefined && typeof callback !== "function") throw new TypeError("response.safeEnd() callback must be a function");
      if (response.headersSent) throw new TypeError("response.safeSend() and response.safeEnd() cannot be called after headers were sent");
      setSafeHeaders(response);
      delegating = true;
      try {
        if (send && originalSend !== undefined) originalSend(authenticated.body);
        else originalEnd(authenticated.body, "utf8", callback);
      } finally {
        delegating = false;
      }
    }

    const end = originalEnd as unknown as (value: unknown, ...rest: unknown[]) => unknown;
    const write = originalWrite as unknown as (value: unknown, ...rest: unknown[]) => unknown;
    try {
      if (originalSend !== undefined) response.send = (body) => enforce(body, [], originalSend, true);
      response.end = ((body?: unknown, ...rest: unknown[]) => enforce(body, rest, end)) as typeof response.end;
      response.write = ((body: unknown, ...rest: unknown[]) => enforce(body, rest, write)) as typeof response.write;
      response.writeHead = ((...args: unknown[]) => {
        let contentType = currentHeader(response, "content-type");
        // Node prefers an explicit third argument even without a reason phrase.
        const headers = typeof args[1] === "string" ? args[2] : args[2] ?? args[1];
        const explicitTypes: string[] = [];
        // writeHead headers override setHeader without necessarily updating
        // getHeader(). Remember the effective type for subsequent writes.
        if (Array.isArray(headers)) {
          if (Array.isArray(headers[0])) {
            for (const [name, value] of headers) {
              if (String(name).toLowerCase() === "content-type") explicitTypes.push(String(value));
            }
          } else {
            for (let index = 0; index < headers.length; index += 2) {
              if (String(headers[index]).toLowerCase() === "content-type") explicitTypes.push(String(headers[index + 1]));
            }
          }
        } else if (headers !== null && typeof headers === "object") {
          for (const [name, value] of Object.entries(headers)) {
            if (name.toLowerCase() === "content-type") explicitTypes.push(String(value));
          }
        }
        if (explicitTypes.length > 0) contentType = explicitTypes.join(", ");
        const result = Reflect.apply(originalWriteHead, response, args);
        committedContentType = contentType;
        return result;
      }) as typeof response.writeHead;
      Object.defineProperty(response, SAFE_NODE_STREAM_SINK, {
        configurable: true,
        value(body: unknown, onFinish: () => void): void {
          const authenticated = authenticateBody(body);
          if (authenticated?.kind !== "node-stream") throw new TypeError("Safe stream sink requires an authenticated SafeNodeStream");
          // The sink stays private and receives only the authenticated renderer's
          // output. Ordinary response.write remains guarded during streaming.
          pipeNodeStream(response, authenticated.body, originalWrite, onFinish);
        },
      });
      if (typeof originalRedirect === "function") {
        Object.assign(response, {
          redirect(...args: unknown[]): unknown {
            // Next writes its redirect URL through write() without choosing a
            // media type. Keep that body passive before it commits the headers.
            const contentType = currentHeader(response, "content-type");
            if (contentType === undefined) response.setHeader("Content-Type", "text/plain; charset=utf-8");
            else assertPassiveContentType(contentType);
            return Reflect.apply(originalRedirect, response, args);
          },
        });
      }
      Object.assign(response, {
        safeSend(html: SafeHtml): void { deliver(html, true); },
        safeEnd(html: SafeHtml, callback?: () => void): NodeResponse {
          deliver(html, false, callback);
          return response;
        },
      });
      wrappedResponses.add(response);
      response.once("finish", restore);
      response.once("close", restore);
      const result = handler(request, response as unknown as SafeApiResponse<Response>);
      if (result !== null && typeof result === "object" && "then" in result) {
        const pending = Promise.resolve(result).catch((error) => {
          restore();
          throw error;
        });
        return pending as Result;
      }
      return result;
    } catch (error) {
      restore();
      throw error;
    }
  };
}

function patchedResponse(OriginalResponse: ResponseConstructor): ResponseConstructor {
  class EnforcedResponse extends OriginalResponse {
    /** Applies the passive-content policy to every JSON-serialized body. */
    static json(data: unknown, init?: ResponseInit): Response {
      const response = OriginalResponse.json(data, init);
      // JSON can contain HTML even when the input is an object, not a string.
      assertPassiveContentType(response.headers.get("content-type"), "JSON response");
      return response;
    }

    /** Recognizes native responses without widening subclass identity checks. */
    static [Symbol.hasInstance](value: unknown): boolean {
      // Native factories, fetch() and clone() allocate OriginalResponse instances.
      // Subclasses such as NextResponse must still require their own prototype.
      const constructor = this === EnforcedResponse ? OriginalResponse : this;
      return Function.prototype[Symbol.hasInstance].call(constructor, value);
    }

    constructor(body?: BodyInit | null, init: ResponseInit = {}) {
      if (Reflect.get(new.target, SAFE_RESPONSE_CONSTRUCTOR) === true) {
        const authenticated = authenticateBody(body);
        if (authenticated === null || authenticated.kind === "node-stream") throw new TypeError("Safe response constructor requires an authenticated SafeHtml or SafeStream body");
        super(authenticated.body, {...init, headers: secureHtmlHeaders(init.headers)});
        registerSafeResponse(this);
        return;
      }
      if (isRecognizableSafeBody(body) || authenticateBody(body) !== null) {
        throw new TypeError("SafeHtml and SafeStream must be passed to SafeResponse or SafeNextResponse, not Response or NextResponse");
      }
      super(body, init);
      if (typeof body === "string") assertPassiveContentType(this.headers.get("content-type"));
    }
  }
  Object.defineProperty(EnforcedResponse, GUARDED_RESPONSE, {value: true});
  return EnforcedResponse;
}

function runBootSelfTest(ResponseClass: ResponseConstructor): void {
  const UncheckedResponse = ResponseClass as unknown as {new(body?: unknown, init?: ResponseInit): Response};
  try {
    new UncheckedResponse(htmlEscape("verified"));
    throw new Error("next-xss-sbyd response wrapper self-test accepted SafeHtml in Response");
  } catch (error) {
    if (!(error instanceof TypeError) || !/SafeResponse/u.test(error.message)) throw error;
  }
  try {
    new ResponseClass("unsafe", {headers: {"Content-Type": "text/html"}});
    throw new Error("next-xss-sbyd response wrapper self-test accepted raw HTML");
  } catch (error) {
    if (!(error instanceof TypeError) || !/Raw string response/u.test(error.message)) throw error;
  }
  class MarkedResponse extends ResponseClass {}
  Object.defineProperty(MarkedResponse, SAFE_RESPONSE_CONSTRUCTOR, {value: true});
  const marked = Reflect.construct(MarkedResponse, [htmlEscape("verified")]) as Response;
  if (marked.headers.get("content-type") !== HTML_CONTENT_TYPE ||
      marked.headers.get("x-content-type-options") !== "nosniff") {
    throw new Error("next-xss-sbyd response guard self-test rejected its marked constructor path");
  }
  try {
    Reflect.construct(ResponseClass, ["unsafe", {headers: {"Content-Type": "text/html"}}], MarkedResponse);
    throw new Error("next-xss-sbyd response guard self-test accepted marked raw HTML");
  } catch (error) {
    if (!(error instanceof TypeError) || !/authenticated SafeHtml or SafeStream/u.test(error.message)) throw error;
  }
  new ResponseClass("plain");
}

/** Reports whether the verified global Response guard wrapper is installed. */
export function isGuardInstalled(): boolean {
  return Reflect.get(globalThis, INSTALLATION_MARKER) === true;
}

/** Installs and verifies Node-only enforcement for the global Fetch Response constructor. */
export function installResponseGuard(): void {
  if (typeof EdgeRuntime !== "undefined") throw new Error("next-xss-sbyd response enforcement supports Node.js only; Edge runtime is unsupported");
  if (isGuardInstalled()) {
    console.warn("next-xss-sbyd response enforcement is already installed");
    return;
  }
  const EnforcedResponse = patchedResponse(OriginalResponse);
  runBootSelfTest(EnforcedResponse);
  globalThis.Response = EnforcedResponse;
  Object.defineProperty(globalThis, INSTALLATION_MARKER, {configurable: false, value: true});
}
