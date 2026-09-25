import {test, type CspAssertions, type CspViolation} from "next-xss-sbyd/playwright";
import {expect, mergeTests, test as base} from "@playwright/test";

const applicationTest = base.extend<{account: string}>({account: "test-account"});
const composed = mergeTests(test, applicationTest).extend<{route: string}>({route: "/"});
composed.use({cspObservation: {quietMs: 50, timeoutMs: 1_000, associationTimeoutMs: 30_000}, viewport: {width: 800, height: 600}});
composed("fixture composition", async ({page, csp, route, account}) => {
  const assertions: CspAssertions = csp;
  await page.goto(route);
  await assertions.assertNoncePolicy(page, {scriptSelector: "script"});
  const records: readonly CspViolation[] = assertions.violations();
  expect(account).toBe("test-account");
  // @ts-expect-error Snapshot records are read-only.
  records.push(records[0]);
  // @ts-expect-error A blocked-behavior assertion callback is mandatory.
  await csp.expectViolation({frame: page.mainFrame(), effectiveDirective: "script-src-attr", disposition: "enforce", blockedURI: "inline", count: 1}, async () => {});
});
