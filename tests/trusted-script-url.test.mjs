import assert from "node:assert/strict";
import test from "node:test";
import {createElement} from "react";
import * as api from "next-xss-sbyd";
import {jsx} from "next-xss-sbyd/jsx-runtime";
import {safeRenderToReadableStream} from "next-xss-sbyd/render";

test("trustedScriptUrl preserves SafeValues construction and legacy interoperability", async () => {
  assert.equal(typeof api.trustedScriptUrl, "function");
  assert.equal(api.trustedScriptUrl, api.trustedResourceUrl);
  const src = api.trustedScriptUrl`/assets/${"a/b"}.js`;
  assert.equal(jsx("script", {src}).props.src, "/assets/a%2Fb.js");
  assert.equal(api.SafeExternalIframe({src, sandbox: ""}).props.src, "/assets/a%2Fb.js");
  assert.equal(jsx("script", {src: api.trustedResourceUrl`/legacy.js`}).props.src, "/legacy.js");
  const stream = await safeRenderToReadableStream(createElement("div", null, "ready"), {
    bootstrapScripts: [src],
    bootstrapModules: [{src: api.trustedScriptUrl`/module.js`, integrity: "sha256-test", crossOrigin: "anonymous"}],
  });
  const body = await new api.SafeResponse(stream).text();
  assert.match(body, /src="\/assets\/a%2Fb.js"/u);
  assert.match(body, /type="module"/u);
  assert.match(body, /integrity="sha256-test"/u);
});

test("active sinks reject strings and forged values with the new type name", async () => {
  for (const src of ["/raw.js", {privateDoNotAccessOrElseWrappedResourceUrl: "/forged.js"}]) {
    assert.throws(() => jsx("script", {src}), /Could not unwrap TrustedScriptUrl/u);
    assert.throws(() => api.SafeExternalIframe({src, sandbox: ""}), /Could not unwrap TrustedScriptUrl/u);
    await assert.rejects(safeRenderToReadableStream(null, {bootstrapScripts: [src]}), /Could not unwrap TrustedScriptUrl/u);
  }
});
