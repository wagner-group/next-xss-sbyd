/** Remove credentials and URL payloads before transport, matching, or diagnostics. */
export function redactCspURL(value: string): string {
  if (!value || value === "inline" || value === "eval" || value === "wasm-eval" || value === "self" || value === "trusted-types-sink" || value === "trusted-types-policy") return value;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? `${url.origin}${url.pathname}` : url.protocol;
  } catch {
    return "";
  }
}

export interface ObserverMessage {
  kind: "ready" | "event" | "checkpoint" | "unsupported";
  documentId: string;
  localSequence: number;
  documentURL: string;
  effectiveDirective?: string;
  disposition?: "enforce" | "report";
  blockedURI?: string;
  sourceURL?: string;
  line?: number;
  column?: number;
}

export interface DocumentObserver {
  documentId: string;
  document: Document;
  checkpoint(): Promise<string>;
}

/** Serialized into each document by BrowserContext.addInitScript. */
export function installCspObserver({ binding, key }: { binding: string; key: string }): void {
  // This function must be self-contained: Playwright serializes its source.
  function redact(value: string): string {
    if (!value || value === "inline" || value === "eval" || value === "wasm-eval" || value === "self" || value === "trusted-types-sink" || value === "trusted-types-policy") return value;
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:" ? `${url.origin}${url.pathname}` : url.protocol;
    } catch { return ""; }
  }
  const target = globalThis as unknown as Record<string, unknown>;
  function newDocumentId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }
  const documentId = newDocumentId();
  let localSequence = 0;
  let failed = false;
  let pending = Promise.resolve();
  function send(message: ObserverMessage): void {
    pending = pending.then(async () => {
      await (target[binding] as (message: ObserverMessage) => Promise<void>)(message);
    }).catch(() => { failed = true; });
  }
  function message(kind: ObserverMessage["kind"]): ObserverMessage {
    return { kind, documentId, localSequence, documentURL: redact(location.href) };
  }
  // Some browser popup/frame paths replace the initial Document without rerunning
  // init scripts. Surviving Window listeners cannot guarantee initial CSP capture;
  // detect that unsupported transition instead of silently initializing late.
  // document.open()/setContent also removes listeners from an isolated utility world.
  // Probe the listener itself instead of monkey-patching document.open().
  let listening = false;
  globalThis.addEventListener(key, function acknowledgeListener() { listening = true; });
  const state: DocumentObserver = {
    documentId,
    document,
    async checkpoint() {
      listening = false;
      globalThis.dispatchEvent(new Event(key));
      if (!listening) throw new Error("CSP observer document was replaced");
      if (!ensureDocument()) throw new Error("CSP observer missing initialization in replacement document");
      // Include an explicit runner acknowledgement, not just a browser-side array read.
      send(message("checkpoint"));
      await pending;
      if (failed || state.document !== document) throw new Error("CSP observer acknowledgement failed");
      return documentId;
    },
  };
  function ensureDocument(): boolean {
    if (state.document === document) return true;
    if (!failed) send(message("unsupported"));
    failed = true;
    return false;
  }
  target[key] = state;
  globalThis.addEventListener("DOMContentLoaded", ensureDocument);
  globalThis.addEventListener("securitypolicyviolation", function record(event) {
    if (!ensureDocument()) return;
    localSequence++;
    send({ ...message("event"), documentURL: redact(event.documentURI),
      effectiveDirective: event.effectiveDirective || "", disposition: event.disposition,
      blockedURI: redact(event.blockedURI), sourceURL: redact(event.sourceFile),
      line: event.lineNumber || 0, column: event.columnNumber || 0 });
  }, true);
  send(message("ready"));
}
