import assert from "node:assert/strict";
import test from "node:test";

import {htmlEscape} from "next-xss-sbyd";
import {installResponseGuard, isGuardInstalled} from "next-xss-sbyd/enforce";

test("installResponseGuard wraps Response with the fixed policy", async () => {
  installResponseGuard();
  assert.equal(isGuardInstalled(), true);
  assert.equal(await new Response("ok").text(), "ok");
  assert.throws(
    () => new Response({privateDoNotAccessOrElseWrappedHtml: "<script>unsafe</script>"}),
    {
      name: "TypeError",
      message: "SafeHtml and SafeStream must be passed to SafeResponse or SafeNextResponse, not Response or NextResponse",
    },
  );

  for (const mediaType of ["TeXt/PlAiN; charset=us-ascii", "application/json", "APPLICATION/PROBLEM+JSON; profile=errors", "application/vnd.example+json", "application/octet-stream", "text/csv", "text/event-stream"]) {
    assert.equal(await new Response("ok", {headers: {"Content-Type": mediaType}}).text(), "ok");
  }
  for (const mediaType of ["text/html", "application/xhtml+xml", "image/svg+xml", "text/javascript", "application/javascript", "text/css", "text/xml", "application/xml", "unknown/unknown", "application/unknown", "*/*", "application/+json", "application/json, text/html", "application/problem+json junk", "text/plain;", "text/plain; charset", "text/plain; charset=\"unterminated"]) {
    assert.throws(() => new Response("unsafe", {headers: {"Content-Type": mediaType}}), /raw string response/i);
  }

  assert.throws(() => new Response(htmlEscape("<b>safe</b>")), /SafeResponse/);
  assert.throws(() => new Response(htmlEscape("safe"), {headers: {"Content-Type": "text/plain"}}), /SafeResponse/);

  const bytes = new Uint8Array([1, 2, 3]);
  assert.deepEqual(new Uint8Array(await new Response(bytes, {headers: {"Content-Type": "text/html"}}).arrayBuffer()), bytes);
  const form = new FormData();
  form.set("name", "value");
  assert.match(new Response(form).headers.get("content-type"), /^multipart\/form-data; boundary=/u);
  assert.equal(new Response(null, {status: 204}).status, 204);
  assert.equal(new Response(null, {status: 304}).status, 304);
  assert.equal(Response.redirect("https://example.test/").status, 302);
});

test("installResponseGuard is an idempotent warning/no-op", () => {
  const installed = globalThis.Response;
  installResponseGuard();
  assert.equal(globalThis.Response, installed);
});

test("installResponseGuard rejects Edge runtime", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "EdgeRuntime");
  Object.defineProperty(globalThis, "EdgeRuntime", {configurable: true, value: "edge-runtime"});
  try {
    assert.throws(() => installResponseGuard(), /Node.*Edge|Edge.*unsupported/i);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "EdgeRuntime", descriptor);
    else delete globalThis.EdgeRuntime;
  }
});
