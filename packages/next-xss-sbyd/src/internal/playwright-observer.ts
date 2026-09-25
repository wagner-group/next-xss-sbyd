/** Remove credentials and URL payloads before transport, matching, or diagnostics. */
export function redactCspURL(value: string): string {
  if (!value || value === "inline" || value === "eval" || value === "wasm-eval" || value === "self" || value === "trusted-types-sink" || value === "trusted-types-policy") return value;
  if (/^[a-z][a-z0-9+.-]*$/i.test(value)) return `${value.toLowerCase()}:`;
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
    if (/^[a-z][a-z0-9+.-]*$/i.test(value)) return `${value.toLowerCase()}:`;
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:" ? `${url.origin}${url.pathname}` : url.protocol;
    } catch { return ""; }
  }
  const target = globalThis as unknown as Record<string, unknown>;
  function newDocumentId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }
  let documentId = newDocumentId();
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
  // Initial same-origin popup/frame navigations can reuse the Window and its
  // listeners without rerunning init scripts. Keep observing that transition,
  // assigning a fresh identity when the new Document first becomes visible.
  let initialDocument = document.URL === "about:blank";
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
      const token = documentId;
      send(message("checkpoint"));
      await pending;
      if (failed || token !== documentId || target[key] !== state || state.document !== document) throw new Error("CSP observer acknowledgement failed");
      return token;
    },
  };
  function ensureDocument(): boolean {
    // WebKit may run a fresh init script while listeners from the initial blank
    // document survive. Only the current observer may report native events.
    if (target[key] !== state) return false;
    if (state.document === document) return true;
    if (initialDocument) {
      initialDocument = false;
      documentId = newDocumentId();
      state.documentId = documentId;
      state.document = document;
      localSequence = 0;
      send(message("ready"));
      return true;
    }
    if (!failed) send(message("unsupported"));
    failed = true;
    return false;
  }
  target[key] = state;
  globalThis.addEventListener("DOMContentLoaded", ensureDocument);
  const seen = new WeakSet<SecurityPolicyViolationEvent>();
  function record(event: SecurityPolicyViolationEvent): void {
    if (!ensureDocument() || seen.has(event)) return;
    seen.add(event);
    localSequence++;
    send({ ...message("event"), documentURL: redact(event.documentURI),
      effectiveDirective: event.effectiveDirective || "", disposition: event.disposition,
      blockedURI: redact(event.blockedURI), sourceURL: redact(event.sourceFile),
      line: event.lineNumber || 0, column: event.columnNumber || 0 });
  }
  // Chromium initial same-origin popups deliver CSP events to surviving bubble
  // listeners but skip surviving capture listeners. Retain capture elsewhere to
  // observe before application handlers, deduplicating only the same native event.
  globalThis.addEventListener("securitypolicyviolation", record, true);
  globalThis.addEventListener("securitypolicyviolation", record);
  send(message("ready"));
}
