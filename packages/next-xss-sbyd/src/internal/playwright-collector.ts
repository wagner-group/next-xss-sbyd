import type { BrowserContext, Frame, Page, Request, Response } from "@playwright/test";
import type { CspAssertions, CspViolation, ExpectedCspViolation, NoncePolicyOptions } from "../playwright.js";
import { installCspObserver, redactCspURL, type DocumentObserver, type ObserverMessage } from "./playwright-observer.js";
import { assertScriptPolicy } from "./playwright-policy.js";

interface NavigationEvidence { request: Request; knownDocuments: Set<string> }

interface ObservedDocument {
  id: string;
  frame: Frame;
  pageId: string;
  frameId: string;
  sequence: number;
  url: string;
  response?: Response;
}
const limitations = [
  "DOM securitypolicyviolation events only; workers and service workers are not observed.",
  "Independent browser contexts and browser-internal documents are not covered.",
  "Initial popup/frame replacements without fresh initialization are rejected; initial-popup response evidence may be unavailable.",
  "An event lost before dispatch or delivery during document replacement or closure may be undetectable.",
  "Flush covers a bounded quiet interval; later events and final context closure are not certified.",
  "This is a regression aid, not an XSS scanner or protection against observer tampering.",
];

/** Runner-owned state, scoped to one test context and retained across document destruction. */
export class CspCollector implements CspAssertions {
  private readonly records: CspViolation[] = [];
  private readonly expected = new Set<number>();
  private readonly errors: string[] = [];
  private readonly documents = new Map<string, ObservedDocument>();
  private readonly pages = new Map<Page, string>();
  private readonly frames = new Map<Frame, string>();
  private readonly responses = new Map<Frame, Response>();
  private readonly requests = new Map<Frame, NavigationEvidence>();
  private readonly navigationEvidence = new WeakMap<Request, NavigationEvidence>();
  private readonly navigationTasks = new Set<Promise<void>>();
  private readonly nonces = new Map<string, string>();
  private readonly key: string;
  private readonly binding: string;
  private lastArrival = 0;
  private expecting = false;
  private expectationDocument?: { frame: Frame; token: string; replaced: boolean };
  private disposed = false;

  constructor(private readonly context: BrowserContext, private readonly browser: CspViolation["browser"],
    private readonly quietMs: number, private readonly timeoutMs: number, id: string) {
    this.key = `__csp_observer_${id}`;
    this.binding = `__csp_delivery_${id}`;
  }

  /** Install before any page is created, observing all context pages and frames. */
  async install(): Promise<void> {
    this.context.on("request", this.onRequest);
    this.context.on("response", this.onResponse);
    this.context.on("page", this.onPage);
    this.context.on("close", this.onClose);
    await this.context.exposeBinding(this.binding, ({ frame, page }, value: ObserverMessage) => this.receive(frame, page, value));
    await this.context.addInitScript(installCspObserver, { binding: this.binding, key: this.key });
  }

  private readonly onRequest = (request: Request): void => {
    if (!request.isNavigationRequest()) return;
    const evidence = { request, knownDocuments: new Set(this.documents.keys()) };
    this.navigationEvidence.set(request, evidence);
    // The initial popup request can precede creation of its Frame in Playwright.
    try { this.requests.set(request.frame(), evidence); } catch { /* Associate at response time. */ }
  };
  private readonly onResponse = (response: Response): void => {
    if (!response.request().isNavigationRequest() || (response.status() >= 300 && response.status() < 400)) return;
    try {
      const frame = response.frame();
      const evidence = this.navigationEvidence.get(response.request());
      if (!this.requests.has(frame) && evidence) this.requests.set(frame, evidence);
      this.responses.set(frame, response);
    } catch { /* Without a frame, this response cannot provide reliable assertion evidence. */ }
  };
  private readonly onPage = (page: Page): void => {
    this.pageId(page);
    page.on("crash", this.onCrash);
    page.on("framenavigated", this.onNavigation);
  };
  private readonly onClose = (): void => { this.error("observed context closed before collection completed"); };
  private readonly onCrash = (page: Page): void => {
    this.error(`page crash (${this.pageId(page)})`);
  };
  private readonly onNavigation = (frame: Frame): void => {
    const response = this.responses.get(frame);
    this.responses.delete(frame);
    if (!response) return; // A same-document navigation has no new response.
    const request = this.requests.get(frame);
    const task = this.associateResponse(frame, response, request);
    this.navigationTasks.add(task);
    void task.finally(() => this.navigationTasks.delete(task));
  };

  private async associateResponse(frame: Frame, response: Response, request: NavigationEvidence | undefined): Promise<void> {
    try {
      const token = await this.documentToken(frame);
      // Fail closed on a competing navigation. Never bind by URL (reloads share URLs).
      if (!request || this.requests.get(frame) !== request || response.request() !== request.request || request.knownDocuments.has(token)) return;
      const doc = this.documents.get(token);
      if (doc && doc.frame === frame && !doc.response && /^https?:/.test(doc.url)) doc.response = response;
    } catch {
      // A destroyed document has no assertion evidence. Live documents are checked by flush.
    }
  }

  private pageId(page: Page): string {
    if (!this.pages.has(page)) this.pages.set(page, `page-${this.pages.size + 1}`);
    return this.pages.get(page)!;
  }
  private frameId(frame: Frame): string {
    if (!this.frames.has(frame)) this.frames.set(frame, `frame-${this.frames.size + 1}`);
    return this.frames.get(frame)!;
  }
  private receive(frame: Frame, page: Page, message: ObserverMessage): void {
    if (this.disposed) return;
    if (message.kind === "ready" && this.expectationDocument?.frame === frame &&
      this.expectationDocument.token !== message.documentId) this.expectationDocument.replaced = true;
    if (message.kind === "unsupported") {
      this.error(`document replaced without before-script initialization (${this.frameId(frame)}, ${redactCspURL(message.documentURL)})`);
      return;
    }
    let doc = this.documents.get(message.documentId);
    if (message.kind === "ready" && !doc) {
      doc = { id: `document-${this.documents.size + 1}`, frame, pageId: this.pageId(page),
        frameId: this.frameId(frame), sequence: 0, url: redactCspURL(message.documentURL) };
      this.documents.set(message.documentId, doc);
    }
    if (!doc || doc.frame !== frame) {
      this.error(`missing initialization (${this.frameId(frame)})`);
      return;
    }
    if (message.kind === "event") {
      if (message.localSequence <= doc.sequence) return; // Transport retry, not native-event deduplication.
      if (message.localSequence !== doc.sequence + 1) this.error(`event sequence gap (${doc.id}, ${doc.url})`);
      doc.sequence = message.localSequence;
      this.records.push(Object.freeze({ sequence: this.records.length + 1, pageId: doc.pageId,
        frameId: doc.frameId, documentId: doc.id, browser: this.browser,
        documentURL: redactCspURL(message.documentURL), effectiveDirective: message.effectiveDirective ?? "",
        disposition: message.disposition ?? "enforce", blockedURI: redactCspURL(message.blockedURI ?? ""),
        sourceURL: redactCspURL(message.sourceURL ?? ""), line: message.line ?? 0, column: message.column ?? 0 }));
      this.lastArrival = Date.now();
    } else if (message.localSequence !== doc.sequence) {
      this.error(`acknowledgement sequence mismatch (${doc.id}, ${doc.url})`);
    }
  }

  private error(detail: string): Error {
    const message = `CSP observation error [${this.browser}]: ${detail}`;
    if (!this.errors.includes(message)) this.errors.push(message);
    return new Error(message);
  }
  private async documentToken(frame: Frame): Promise<string> {
    return frame.evaluate(async key => {
      const state = (globalThis as unknown as Record<string, DocumentObserver>)[key];
      if (!state) throw new Error("Missing CSP observer initialization");
      return state.checkpoint();
    }, this.key);
  }
  private async bounded<T>(operation: Promise<T>, deadline: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("CSP collection timed out")), Math.max(0, deadline - Date.now()));
      })]);
    } finally { clearTimeout(timer); }
  }
  private async checkpoint(deadline: number): Promise<string> {
    const documents: string[] = [];
    await this.bounded(Promise.all(this.context.pages().flatMap(page => page.frames()).map(async frame => {
      try {
        const token = await this.documentToken(frame);
        const doc = this.documents.get(token);
        if (!doc || doc.frame !== frame) throw new Error("Missing ready acknowledgement");
        documents.push(doc.id);
      } catch {
        throw this.error(`failed document acknowledgement (${this.frameId(frame)}, ${redactCspURL(frame.url())})`);
      }
    })), deadline);
    await this.bounded(Promise.all([...this.navigationTasks]), deadline);
    if (this.errors.length) throw new Error(this.errors.join("\n"));
    return documents.sort().join(",");
  }

  /** Return immutable runner records without acknowledging any of them. */
  violations(): readonly CspViolation[] { return Object.freeze([...this.records]); }

  /** Wait for live-document acknowledgements and a bounded quiet period. */
  async flush(): Promise<void> {
    await this.flushUntil(Date.now() + this.timeoutMs);
  }
  private async flushUntil(deadline: number): Promise<void> {
    let signature = "";
    let quietSince = Date.now();
    try {
      for (;;) {
        const current = await this.checkpoint(deadline);
        if (current !== signature) { signature = current; quietSince = Date.now(); }
        quietSince = Math.max(quietSince, this.lastArrival);
        if (Date.now() - quietSince >= this.quietMs) return;
        if (Date.now() >= deadline) throw new Error("CSP collection timed out");
        await new Promise(resolve => setTimeout(resolve, Math.min(20, this.quietMs, Math.max(1, deadline - Date.now()))));
      }
    } catch {
      throw this.error("flush failed or timed out; live documents did not acknowledge a quiet interval");
    }
  }

  /** Check only the response that created this observed document, without a new request. */
  async assertNoncePolicy(page: Page, options: NoncePolicyOptions): Promise<void> {
    if (page.context() !== this.context) throw new Error("Nonce assertion requires a page in the observed context");
    await this.flush();
    const token = await this.documentToken(page.mainFrame());
    const doc = this.documents.get(token)!;
    if (!doc.response || !/^https?:/.test(doc.response.url())) {
      throw new Error("Nonce assertion requires reliable HTTP(S) response evidence for the current document");
    }
    // Errors from Playwright can contain HTML or selector input. Keep this boundary private.
    let scripts: { isScript: boolean; nonce: string }[];
    try {
      scripts = await page.locator(options.scriptSelector).evaluateAll(elements =>
        elements.map(element => ({ isScript: element instanceof HTMLScriptElement,
          nonce: element instanceof HTMLScriptElement ? element.nonce : "" })));
    } catch { throw new Error("Nonce assertion could not evaluate the script selection"); }
    let headers: { name: string; value: string }[];
    try { headers = await doc.response.headersArray(); }
    catch { throw new Error("Nonce assertion could not read document response headers"); }
    const nonce = assertScriptPolicy(headers, scripts);
    if (await this.documentToken(page.mainFrame()) !== token) throw new Error("Document changed during nonce assertion");
    if (this.nonces.has(doc.id) && this.nonces.get(doc.id) !== nonce) throw new Error("Nonce changed within the same document");
    for (const [id, previous] of this.nonces) {
      if (id !== doc.id && previous === nonce) throw new Error("Nonce reused across distinct documents in this test");
    }
    this.nonces.set(doc.id, nonce);
  }

  /** Accept only exact events from this action after an independent blocked-behavior assertion. */
  async expectViolation(expected: ExpectedCspViolation, action: () => Promise<void>, assertBlocked: () => Promise<void>): Promise<void> {
    if (this.expecting) throw new Error("Nested or simultaneous CSP expectations are unsupported");
    if (!Number.isSafeInteger(expected.count) || expected.count <= 0 ||
      typeof expected.effectiveDirective !== "string" || !expected.effectiveDirective ||
      typeof expected.blockedURI !== "string" || !expected.blockedURI ||
      !["enforce", "report"].includes(expected.disposition) ||
      (expected.sourceURL !== undefined && typeof expected.sourceURL !== "string") ||
      typeof action !== "function" || typeof assertBlocked !== "function") {
      throw new Error("CSP expectation requires exact directive, disposition, blocked URI, positive count, and two callbacks");
    }
    if (expected.frame.page().context() !== this.context) throw new Error("CSP expectation frame is outside the observed context");
    this.expecting = true;
    try {
      await this.flush();
      const token = await this.documentToken(expected.frame);
      const doc = this.documents.get(token)!;
      const start = this.records.length;
      this.expectationDocument = { frame: expected.frame, token, replaced: false };
      await action();
      const deadline = Date.now() + this.timeoutMs;
      for (;;) {
        await this.flushUntil(deadline);
        this.checkInterval(expected, doc, start, false);
        if (this.records.length - start >= expected.count) break;
        if (Date.now() >= deadline) throw new Error("Expected CSP violation count was not received");
      }
      if (this.expectationDocument.replaced || await this.documentToken(expected.frame) !== token) throw new Error("Expectation document was replaced");
      await assertBlocked();
      await this.flush();
      if (this.expectationDocument.replaced || await this.documentToken(expected.frame) !== token) throw new Error("Expectation document was replaced");
      this.checkInterval(expected, doc, start, true);
      for (const record of this.records.slice(start)) this.expected.add(record.sequence);
    } finally { this.expecting = false; this.expectationDocument = undefined; }
  }
  private checkInterval(expected: ExpectedCspViolation, doc: ObservedDocument, start: number, exact: boolean): void {
    const interval = this.records.slice(start);
    const matches = interval.filter(record => record.documentId === doc.id && record.effectiveDirective === expected.effectiveDirective &&
      record.disposition === expected.disposition && record.blockedURI === redactCspURL(expected.blockedURI) &&
      (expected.sourceURL === undefined || record.sourceURL === redactCspURL(expected.sourceURL)));
    if (matches.length !== interval.length || matches.length > expected.count || (exact && matches.length !== expected.count)) {
      throw new Error(`CSP expectation did not match exact interval: wanted ${expected.count}, matched ${matches.length}, received ${interval.length}`);
    }
  }

  /** Fail teardown on all events not accepted by a completed expectation. */
  assertNoUnexpected(): void {
    const unexpected = this.records.filter(record => !this.expected.has(record.sequence));
    if (unexpected.length) {
      const groups = new Map<string, number>();
      for (const record of unexpected) {
        const detail = `${record.effectiveDirective} (${record.disposition}) ${record.documentId} ${record.documentURL} at ${record.sourceURL}:${record.line}:${record.column}`;
        groups.set(detail, (groups.get(detail) ?? 0) + 1);
      }
      const details = [...groups].slice(0, 10).map(([detail, count]) => `${count} × ${detail}`);
      if (groups.size > 10) details.push("Further locations are listed in csp-observation.json");
      throw new Error(`Unexpected CSP violations: ${unexpected.length}\n${details.join("\n")}`);
    }
  }
  /** Produce a privacy-safe attachment; raw headers and nonces never leave assertion memory. */
  report(project: string): object {
    return { schemaVersion: 1, browser: this.browser, project, violations: this.records,
      expectedSequences: [...this.expected], observationErrors: this.errors, limitations };
  }
  /** Detach runner listeners once the fixture has attached its final report. */
  dispose(): void {
    this.disposed = true;
    this.context.off("request", this.onRequest);
    this.context.off("response", this.onResponse);
    this.context.off("page", this.onPage);
    this.context.off("close", this.onClose);
    for (const page of this.pages.keys()) {
      page.off("crash", this.onCrash);
      page.off("framenavigated", this.onNavigation);
    }
    this.responses.clear();
    this.requests.clear();
    this.documents.clear();
    this.nonces.clear();
  }
}
