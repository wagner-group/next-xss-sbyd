import type {ReactNode} from "react";
import {
  renderToPipeableStream,
  renderToReadableStream,
  renderToString,
} from "react-dom/server";
import type {
  BootstrapScriptDescriptor,
  RenderToPipeableStreamOptions,
  RenderToReadableStreamOptions,
  ServerOptions,
} from "react-dom/server";
import {htmlSafeByReview} from "safevalues/restricted/reviewed";
import type {TrustedScriptUrl} from "./trusted-script-url.js";
import type {CspNonce} from "./csp.js";
import {
  InternalSafeNodeStream,
  InternalSafeStream,
} from "./internal/stream.js";
import type {SafeNodeStream, SafeStream} from "./internal/stream.js";
import {unwrapResourceUrl} from "./internal/unwrap.js";

export type {SafeNodeStream, SafeStream} from "./internal/stream.js";

export interface SafeBootstrapScriptDescriptor extends Omit<BootstrapScriptDescriptor, "src"> {
  readonly src: TrustedScriptUrl;
}
export type SafeBootstrapScript = TrustedScriptUrl | SafeBootstrapScriptDescriptor;

export type SafeRenderOptions = ServerOptions;

type UnsafeStreamOption = "bootstrapModules" | "bootstrapScriptContent" | "bootstrapScripts" | "importMap" | "namespaceURI" | "nonce";
export interface SafeReadableStreamOptions extends Omit<RenderToReadableStreamOptions, UnsafeStreamOption> {
  readonly nonce?: CspNonce;
  readonly bootstrapScripts?: readonly SafeBootstrapScript[];
  readonly bootstrapModules?: readonly SafeBootstrapScript[];
}
export interface SafePipeableStreamOptions extends Omit<RenderToPipeableStreamOptions, UnsafeStreamOption | "onAllReady" | "onError" | "onShellError" | "onShellReady"> {
  readonly nonce?: CspNonce;
  readonly bootstrapScripts?: readonly SafeBootstrapScript[];
  readonly bootstrapModules?: readonly SafeBootstrapScript[];
  readonly onAllReady?: () => void;
  readonly onError?: (error: unknown) => void;
  readonly onShellError?: (error: unknown) => void;
  readonly onShellReady?: () => void;
}

function unwrapBootstrapScripts(scripts?: readonly SafeBootstrapScript[]): BootstrapScriptDescriptor[] | undefined {
  return scripts?.map((script) => Object.prototype.hasOwnProperty.call(script, "src")
    ? {...script as SafeBootstrapScriptDescriptor, src: unwrapResourceUrl((script as SafeBootstrapScriptDescriptor).src)}
    : {src: unwrapResourceUrl(script as TrustedScriptUrl)});
}

/** Renders React-controlled HTML and returns it as SafeHtml. */
export function safeRenderToString(node: ReactNode, options: SafeRenderOptions = {}) {
  const html = renderToString(node, {identifierPrefix: options.identifierPrefix});
  return htmlSafeByReview(html, {justification: "Rendered entirely by React's escaping server renderer"});
}

/** Renders a React tree into an opaque Web stream accepted by SafeResponse and SafeNextResponse. */
export async function safeRenderToReadableStream(
  node: ReactNode,
  options: SafeReadableStreamOptions = {},
): Promise<SafeStream> {
  const stream = await renderToReadableStream(node, {
    identifierPrefix: options.identifierPrefix,
    nonce: options.nonce,
    onError: options.onError,
    progressiveChunkSize: options.progressiveChunkSize,
    signal: options.signal,
    bootstrapScripts: unwrapBootstrapScripts(options.bootstrapScripts),
    bootstrapModules: unwrapBootstrapScripts(options.bootstrapModules),
  });
  return new InternalSafeStream(stream);
}

/** Renders a React tree into a legacy opaque Node stream accepted only by safePipe. */
export function safeRenderToPipeableStream(
  node: ReactNode,
  options: SafePipeableStreamOptions = {},
): SafeNodeStream {
  let safeStream: InternalSafeNodeStream | undefined;
  const pending: Array<{event: "shell-ready" | "shell-error" | "all-ready" | "error"; error?: unknown}> = [];
  function emit(event: "shell-ready" | "shell-error" | "all-ready" | "error", error?: unknown): void {
    if (safeStream === undefined) pending.push({event, error});
    else safeStream.emit(event, error);
  }
  const stream = renderToPipeableStream(node, {
    identifierPrefix: options.identifierPrefix,
    nonce: options.nonce,
    progressiveChunkSize: options.progressiveChunkSize,
    bootstrapScripts: unwrapBootstrapScripts(options.bootstrapScripts),
    bootstrapModules: unwrapBootstrapScripts(options.bootstrapModules),
    onShellReady() { try { options.onShellReady?.(); } finally { emit("shell-ready"); } },
    onShellError(error) { try { options.onShellError?.(error); } finally { emit("shell-error", error); } },
    onAllReady() { try { options.onAllReady?.(); } finally { emit("all-ready"); } },
    onError(error) { try { options.onError?.(error); } finally { emit("error", error); } },
  });
  safeStream = new InternalSafeNodeStream(stream);
  for (const item of pending) safeStream.emit(item.event, item.error);
  return safeStream;
}
