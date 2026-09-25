import {test} from "next-xss-sbyd/playwright";

for (const [name, options] of [
  ["nonfinite", {quietMs: Infinity}],
  ["nan", {quietMs: NaN}],
  ["null", {quietMs: null}],
  ["zero timeout", {timeoutMs: 0}],
  ["fractional timeout", {timeoutMs: 100.5}],
  ["null timeout", {timeoutMs: null}],
]) {
  test.describe(name, () => {
    test.use({cspObservation: options});
    test(`FAIL invalid quiet settings ${name}`, async () => {});
  });
}

for (const [name, override] of [
  ["empty directive", {effectiveDirective: ""}],
  ["empty URI", {blockedURI: ""}],
  ["unknown disposition", {disposition: "unknown"}],
  ["non-string source", {sourceURL: true}],
  ["nonfinite count", {count: Infinity}],
]) {
  test(`FAIL invalid expectation ${name}`, async ({page, csp}) => {
    await csp.expectViolation({frame: page.mainFrame(), effectiveDirective: "script-src-attr",
      disposition: "enforce", blockedURI: "inline", count: 1, ...override}, async () => {}, async () => {});
  });
}
test("FAIL missing assertion callback", async ({page, csp}) => {
  await csp.expectViolation({frame: page.mainFrame(), effectiveDirective: "script-src-attr",
    disposition: "enforce", blockedURI: "inline", count: 1}, async () => {});
});
