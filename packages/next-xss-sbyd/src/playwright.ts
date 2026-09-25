import { randomUUID } from "node:crypto";
import { test as base, type Frame, type Page } from "@playwright/test";
import { CspCollector } from "./internal/playwright-collector.js";

export interface CspOptions {
  cspObservation: { quietMs?: number; timeoutMs?: number };
}
export interface CspFixtures { csp: CspAssertions }
export interface CspViolation {
  readonly sequence: number;
  readonly pageId: string;
  readonly frameId: string;
  readonly documentId: string;
  readonly browser: "chromium" | "firefox" | "webkit";
  readonly documentURL: string;
  readonly effectiveDirective: string;
  readonly disposition: "enforce" | "report";
  readonly blockedURI: string;
  readonly sourceURL: string;
  readonly line: number;
  readonly column: number;
}
export interface ExpectedCspViolation {
  frame: Frame;
  effectiveDirective: string;
  disposition: "enforce" | "report";
  blockedURI: string;
  sourceURL?: string;
  count: number;
}
export interface NoncePolicyOptions { scriptSelector: string }
export interface CspAssertions {
  /** Return a frozen snapshot, including records accepted by successful expectations. */
  violations(): readonly CspViolation[];
  /** Acknowledge queued events and wait for a bounded quiet observation interval. */
  flush(): Promise<void>;
  /** Check the current document's enforcing response policies and selected script nonces. */
  assertNoncePolicy(page: Page, options: NoncePolicyOptions): Promise<void>;
  /** Accept an exact interval of violations only after the blocked-behavior assertion passes. */
  expectViolation(expected: ExpectedCspViolation, action: () => Promise<void>, assertBlocked: () => Promise<void>): Promise<void>;
}

/** Playwright test with automatic context-wide CSP observation and teardown checks. */
export const test = base.extend<CspFixtures & CspOptions>({
  cspObservation: [{}, { option: true }],
  csp: [async ({ context, browserName, bypassCSP, contextOptions, cspObservation }, use, testInfo) => {
    const quietMs = cspObservation.quietMs === undefined ? 100 : cspObservation.quietMs;
    const timeoutMs = cspObservation.timeoutMs === undefined ? 2_000 : cspObservation.timeoutMs;
    const collector = new CspCollector(context, browserName, quietMs, timeoutMs, randomUUID().replaceAll("-", ""));
    try {
      if (![quietMs, timeoutMs].every(value => Number.isSafeInteger(value) && value > 0) || quietMs >= timeoutMs) {
        throw new Error("cspObservation requires positive integer quietMs < timeoutMs");
      }
      if (bypassCSP || contextOptions.bypassCSP) throw new Error("CSP observation does not support bypassCSP: true");
      if (context.pages().length) throw new Error("CSP observation requires a context without precreated pages; do not replace context or page fixtures");
      await collector.install();
      await use(collector);
      const failures: Error[] = [];
      try { await collector.flush(); } catch (error) { failures.push(error as Error); }
      try { collector.assertNoUnexpected(); } catch (error) { failures.push(error as Error); }
      if (failures.length) throw new Error(failures.map(error => error.message).join("\n"));
    } finally {
      try {
        await testInfo.attach("csp-observation.json", {
          body: Buffer.from(JSON.stringify(collector.report(testInfo.project.name), null, 2)),
          contentType: "application/json",
        });
      } finally { collector.dispose(); }
    }
  }, { auto: true, timeout: 0 }],
});
