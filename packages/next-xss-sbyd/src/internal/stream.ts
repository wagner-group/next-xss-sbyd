import type {PipeableStream, ReactDOMServerReadableStream} from "react-dom/server";

declare const safeStreamBrand: unique symbol;
declare const safeNodeStreamBrand: unique symbol;

export interface SafeStream {
  readonly allReady: Promise<void>;
  readonly [safeStreamBrand]: true;
}

export interface SafeNodeStream {
  abort(reason?: unknown): void;
  readonly [safeNodeStreamBrand]: true;
}

export class InternalSafeStream implements SafeStream {
  declare readonly [safeStreamBrand]: true;
  readonly allReady: Promise<void>;
  readonly #stream: ReactDOMServerReadableStream;

  constructor(stream: ReactDOMServerReadableStream) {
    this.#stream = stream;
    this.allReady = stream.allReady;
  }

  unwrap(): ReadableStream<Uint8Array> {
    return this.#stream as ReadableStream<Uint8Array>;
  }
}

export type NodeStreamEvent = "shell-ready" | "shell-error" | "all-ready" | "error";
export type NodeStreamListener = (event: NodeStreamEvent, error?: unknown) => void;

export class InternalSafeNodeStream implements SafeNodeStream {
  declare readonly [safeNodeStreamBrand]: true;
  readonly #stream: PipeableStream;
  #listener?: NodeStreamListener;
  #events: Array<{event: NodeStreamEvent; error?: unknown}> = [];

  constructor(stream: PipeableStream) {
    this.#stream = stream;
  }

  abort(reason?: unknown): void {
    this.#stream.abort(reason);
  }

  pipe(destination: NodeJS.WritableStream): void {
    this.#stream.pipe(destination);
  }

  emit(event: NodeStreamEvent, error?: unknown): void {
    if (this.#listener === undefined) this.#events.push({event, error});
    else this.#listener(event, error);
  }

  listen(listener: NodeStreamListener): void {
    if (this.#listener !== undefined) throw new TypeError("SafeNodeStream can be piped only once");
    this.#listener = listener;
    for (const item of this.#events) listener(item.event, item.error);
    this.#events = [];
  }
}

export function unwrapSafeStream(stream: SafeStream): ReadableStream<Uint8Array> {
  if (!(stream instanceof InternalSafeStream)) throw new TypeError("Invalid SafeStream; pass the direct result of safeRenderToReadableStream");
  return stream.unwrap();
}

export function unwrapSafeNodeStream(stream: SafeNodeStream): InternalSafeNodeStream {
  if (!(stream instanceof InternalSafeNodeStream)) throw new TypeError("Invalid SafeNodeStream; pass the direct result of safeRenderToPipeableStream");
  return stream;
}
