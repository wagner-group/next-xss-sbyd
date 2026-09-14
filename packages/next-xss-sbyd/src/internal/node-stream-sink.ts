import type {ServerResponse} from "node:http";
import type {Http2ServerResponse} from "node:http2";
import {Writable} from "node:stream";
import type {InternalSafeNodeStream} from "./stream.js";

/** Pipes authenticated renderer output with backpressure and disconnect cleanup. */
export function pipeNodeStream(
  response: ServerResponse | Http2ServerResponse,
  stream: InternalSafeNodeStream,
  write: (chunk: Uint8Array | string, encoding: BufferEncoding) => boolean,
  onFinish: () => void,
): void {
  const sink = new Writable({
    write(chunk, encoding, callback) {
      // Middleware may omit write callbacks; use the same protocol as Readable.pipe.
      if (write(chunk, encoding)) callback();
      else response.once("drain", () => callback());
    },
  });
  response.once("close", () => sink.destroy());
  sink.once("error", (error) => response.destroy(error));
  // Do not expose the private writable as the callback's receiver or argument.
  sink.once("finish", function finishAuthenticatedStream() { onFinish(); });
  stream.pipe(sink);
}
