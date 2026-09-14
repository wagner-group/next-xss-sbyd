import {registerSafeResponse} from "./internal/response-provenance.js";
import {NextResponse} from "next/server.js";
import type {ServerResponse} from "node:http";
import {pipeNodeStream} from "./internal/node-stream-sink.js";
import type {SafeHtml} from "safevalues";
import "./internal/response-body.js";
import {unwrapHtml} from "./internal/unwrap.js";
import {InternalSafeStream, unwrapSafeNodeStream, unwrapSafeStream} from "./internal/stream.js";
import type {SafeNodeStream, SafeStream} from "./internal/stream.js";
import {GUARDED_RESPONSE, SAFE_NODE_STREAM_SINK, SAFE_RESPONSE_CONSTRUCTOR, secureHtmlHeaders} from "./internal/response-policy.js";

export type SafeResponseInit = Omit<ResponseInit, "headers"> & {headers?: HeadersInit};

/** Authenticates HTML and prepares it for the native or guarded parent constructor. */
function htmlResponseArguments(parent: typeof Response, html: SafeHtml | SafeStream, init: SafeResponseInit): [BodyInit, ResponseInit] {
  // Validate locally even if the parent claims to be guarded: that marker is only
  // a routing hint and can be copied onto an unguarded constructor.
  const secured = {...init, headers: secureHtmlHeaders(init.headers)};
  const body = html instanceof InternalSafeStream ? unwrapSafeStream(html) : unwrapHtml(html as SafeHtml);
  if (Reflect.get(parent, GUARDED_RESPONSE) === true) {
    // The guard independently authenticates the original body and installs headers.
    return [html as unknown as BodyInit, init];
  }
  return [body, secured];
}

/** A Fetch Response that accepts SafeHtml or SafeStream and owns its HTML security headers. */
export class SafeResponse extends Response {
  /** Creates an authenticated HTML response with fixed security headers. */
  constructor(html: SafeHtml | SafeStream, init: SafeResponseInit = {}) {
    super(...htmlResponseArguments(Object.getPrototypeOf(SafeResponse), html, init));
    registerSafeResponse(this);
  }
}

/** A NextResponse that accepts SafeHtml or SafeStream and owns its HTML security headers. */
export class SafeNextResponse extends NextResponse {
  /** Creates an authenticated HTML response with fixed security headers. */
  constructor(html: SafeHtml | SafeStream, init: SafeResponseInit = {}) {
    super(...htmlResponseArguments(Object.getPrototypeOf(SafeNextResponse), html, init));
    registerSafeResponse(this);
  }
}

Object.defineProperty(SafeResponse, SAFE_RESPONSE_CONSTRUCTOR, {value: true});
Object.defineProperty(SafeNextResponse, SAFE_RESPONSE_CONSTRUCTOR, {value: true});

export type HtmlNodeResponse = ServerResponse;

export interface SafePipeOptions {
  readonly headers?: HeadersInit;
  readonly onError?: (error: unknown) => void;
  readonly status?: number;
}

/** Pipes a React-owned Node stream with fixed HTML headers and fail-closed error handling. */
export function safePipe(response: HtmlNodeResponse, safeStream: SafeNodeStream, options: SafePipeOptions = {}): void {
  const stream = unwrapSafeNodeStream(safeStream);
  const headers = secureHtmlHeaders(options.headers);
  const pipeAuthenticated = Reflect.get(response, SAFE_NODE_STREAM_SINK) as ((body: SafeNodeStream, onFinish: () => void) => void) | undefined;
  let shellFlushed = false;
  let finished = false;
  let renderComplete = false;
  let sourceEnded = false;

  function finishSuccessfulResponse(): void {
    if (!finished && renderComplete && sourceEnded) {
      finished = true;
      response.end();
    }
  }

  function finishSource(): void {
    sourceEnded = true;
    finishSuccessfulResponse();
  }

  stream.listen((event, error) => {
    if (finished) return;
    if (event === "shell-ready") {
      shellFlushed = true;
      response.statusCode = options.status ?? 200;
      for (const [name, value] of headers) response.setHeader(name, value);
      if (pipeAuthenticated !== undefined) pipeAuthenticated(safeStream, finishSource);
      else pipeNodeStream(response, stream, response.write.bind(response), finishSource);
      return;
    }
    if (event === "shell-error") {
      finished = true;
      if (!response.headersSent) {
        response.statusCode = 500;
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.end("Internal Server Error");
      } else {
        response.destroy(error instanceof Error ? error : new Error("React render failed before shell readiness"));
      }
      options.onError?.(error);
      return;
    }
    if (event === "error" && shellFlushed) {
      finished = true;
      stream.abort(error);
      response.destroy(error instanceof Error ? error : new Error("React render failed after shell readiness"));
      options.onError?.(error);
      return;
    }
    if (event === "all-ready") {
      renderComplete = true;
      finishSuccessfulResponse();
    }
  });
}
