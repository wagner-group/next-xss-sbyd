import assert from "node:assert/strict";
import test from "node:test";

import {JSDOM} from "jsdom";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {safeScript, safeStyleSheet} from "safevalues";
import {
  htmlEscape,
  readJsonScript,
  SafeBlock,
  SafeExternalIframe,
  SafeIframe,
  SafeJsonLdScript,
  SafeJsonScript,
  SafeScriptBlock,
  SafeStyleBlock,
  serializeJsonForHtml,
  trustedResourceUrl,
} from "next-xss-sbyd";

test("SafeIframe remains an alias for SafeExternalIframe", () => {
  assert.equal(SafeIframe, SafeExternalIframe);
  const src = trustedResourceUrl`https://video.example/embed/123`;
  assert.equal(
    renderToStaticMarkup(createElement(SafeIframe, {src, sandbox: ""})),
    '<iframe sandbox="" src="https://video.example/embed/123"></iframe>',
  );
});

test("SafeExternalIframe renders only trusted resources under a fixed sandbox policy", () => {
  const src = trustedResourceUrl`https://video.example/embed/123`;
  const onLoad = () => undefined;
  const iframe = SafeExternalIframe({
    src,
    sandbox: "allow-scripts",
    title: "Example video",
    loading: "lazy",
    className: "embed",
    onLoad,
  });
  assert.equal(iframe.props.onLoad, onLoad);
  const output = renderToStaticMarkup(iframe);
  assert.equal(
    output,
    '<iframe title="Example video" loading="lazy" class="embed" sandbox="allow-scripts" src="https://video.example/embed/123"></iframe>',
  );
  assert.equal(
    renderToStaticMarkup(createElement(SafeExternalIframe, {src, sandbox: "", title: "Static content"})),
    '<iframe title="Static content" sandbox="" src="https://video.example/embed/123"></iframe>',
  );
});

test("SafeExternalIframe rejects values that bypass its TypeScript contract", () => {
  const src = trustedResourceUrl`https://video.example/embed/123`;
  for (const invalidSrc of ["https://video.example/embed/123", {privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: "https://video.example/embed/123"}]) {
    assert.throws(
      () => renderToStaticMarkup(createElement(SafeExternalIframe, {src: invalidSrc, sandbox: ""})),
      /unwrap TrustedResourceUrl/,
    );
  }
  for (const sandbox of ["allow-same-origin", "allow-scripts allow-same-origin", "allow-popups", undefined]) {
    assert.throws(
      () => renderToStaticMarkup(createElement(SafeExternalIframe, {src, sandbox})),
      /Unsafe SafeExternalIframe sandbox/,
    );
  }
  for (const props of [
    {SANDBOX: "allow-scripts allow-same-origin"},
    {SRC: "javascript:alert(1)"},
    {srcDoc: "<script>alert(1)</script>"},
    {SRCDOC: "<script>alert(1)</script>"},
    {dangerouslySetInnerHTML: {__html: "<script>alert(1)</script>"}},
    {DangerouslyAnything: "unsafe"},
  ]) {
    assert.throws(
      () => renderToStaticMarkup(createElement(SafeExternalIframe, {src, sandbox: "", ...props})),
      /Unsafe SafeExternalIframe prop/,
    );
  }
});

test("SafeBlock unwraps SafeHtml into only an inert container", () => {
  const output = renderToStaticMarkup(createElement(SafeBlock, {
    as: "section",
    className: "content",
    html: htmlEscape("<img src=x onerror=alert(1)>"),
  }));
  assert.equal(output, '<section class="content">&lt;img src=x onerror=alert(1)&gt;</section>');
  assert.throws(() => renderToStaticMarkup(createElement(SafeBlock, {html: "<script>alert(1)</script>"})), /unwrap SafeHtml/);
  assert.throws(() => renderToStaticMarkup(createElement(SafeBlock, {as: "script", html: htmlEscape("alert(1)")})), /Unsafe SafeBlock/);
});

test("JSON data blocks cannot close their script element or open HTML contexts", () => {
  const payload = "</script><script>globalThis.__XSS__=true</script><!--\u2028\u2029&>";
  const state = renderToStaticMarkup(createElement(SafeJsonScript, {id: "state", data: {payload}}));
  const jsonLd = renderToStaticMarkup(createElement(SafeJsonLdScript, {data: {name: payload}}));
  assert.equal((state.match(/<script/g) ?? []).length, 1);
  assert.match(state, /type="application\/json"/);
  assert.doesNotMatch(state, /<\/script><script>|<!--/);
  assert.match(state, /\\u003c\/script\\u003e/);
  assert.match(jsonLd, /type="application\/ld\+json"/);
});

test("JSON serializer rejects every non-JSON runtime shape and snapshots shared values", () => {
  const cyclic = {}; cyclic.self = cyclic;
  for (const value of [NaN, Infinity, 1n, undefined, Symbol("x"), () => {}, new Date(), cyclic, {toJSON() { return "surprise"; }}]) {
    assert.throws(() => serializeJsonForHtml(value), /JSON data|plain objects|toJSON/);
  }
  const shared = {safe: true};
  assert.equal(serializeJsonForHtml({one: shared, two: shared}), '{"one":{"safe":true},"two":{"safe":true}}');
  assert.equal(serializeJsonForHtml({["__proto__"]: null, constructor: "value"}), '{"__proto__":null,"constructor":"value"}');
  assert.throws(() => serializeJsonForHtml({[Symbol("hidden")]: "value"}), /symbol keys/);
  assert.throws(() => serializeJsonForHtml(Array(1)), /unsupported undefined/);
});

test("script and style blocks unwrap only SafeValues", () => {
  assert.equal(renderToStaticMarkup(createElement(SafeScriptBlock, {script: safeScript`globalThis.ok = true;`})), "<script>globalThis.ok = true;</script>");
  assert.equal(renderToStaticMarkup(createElement(SafeStyleBlock, {css: safeStyleSheet`body { color: green; }`})), "<style>body { color: green; }</style>");
  assert.throws(() => renderToStaticMarkup(createElement(SafeScriptBlock, {script: "alert(1)"})), /unwrap SafeScript/);
});

test("readJsonScript accepts only the paired application/json element", () => {
  const dom = new JSDOM('<script id="state" type="application/json">{"ok":true}</script><div id="wrong">{}</div>');
  const previousDocument = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    assert.deepEqual(readJsonScript("state"), {ok: true});
    assert.throws(() => readJsonScript("missing"), /not found/);
    assert.throws(() => readJsonScript("wrong"), /not found/);
  } finally {
    globalThis.document = previousDocument;
  }
});
