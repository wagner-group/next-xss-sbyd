import assert from "node:assert/strict";
import test from "node:test";

import {htmlEscape, SafeNextResponse, SafeResponse} from "next-xss-sbyd";
import {unsafeHtmlDoNotUseOrReviewCarefully} from "next-xss-sbyd/restricted";

test("SafeResponse emits only unwrapped SafeHtml with fixed security headers", async () => {
  const headers = new Headers({"x-test": "preserved"});
  const response = new SafeResponse(htmlEscape("<script>alert(1)</script>"), {headers, status: 201});
  assert.equal(await response.text(), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-test"), "preserved");
  assert.equal(headers.has("content-type"), false, "caller headers were not mutated");
});

test("raw strings fail closed at runtime before any response is emitted", () => {
  assert.throws(() => new SafeResponse("<script>alert(1)</script>"), /Could not unwrap SafeHtml/);
});

test("safe response classes reject overrides in every header representation", () => {
  const cases = [
    {headers: {"Content-Type": "text/plain"}},
    {headers: [["content-TYPE", "text/plain"]]},
    {headers: new Headers({"X-Content-Type-Options": "off"})},
  ];
  for (const init of cases) {
    assert.throws(() => new SafeResponse(htmlEscape("ok"), init), /security header/i);
    assert.throws(() => new SafeNextResponse(htmlEscape("ok"), init), /security header/i);
  }
});

test("SafeNextResponse preserves NextResponse behavior", async () => {
  const response = new SafeNextResponse(htmlEscape("next"), {status: 202, headers: {"x-test": "yes"}});
  assert.equal(await response.text(), "next");
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-test"), "yes");
});

test("restricted conversion requires a non-empty review justification", async () => {
  assert.throws(() => unsafeHtmlDoNotUseOrReviewCarefully("<b>ok</b>", "  "), /justification/i);
  const reviewed = unsafeHtmlDoNotUseOrReviewCarefully("<b>ok</b>", "static audited markup");
  assert.equal(await new SafeResponse(reviewed).text(), "<b>ok</b>");
});
