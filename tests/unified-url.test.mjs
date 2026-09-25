import assert from "node:assert/strict";
import test from "node:test";
import {renderToStaticMarkup} from "react-dom/server";
import * as api from "next-xss-sbyd";
import {jsx, jsxs} from "next-xss-sbyd/jsx-runtime";
import {jsxDEV} from "next-xss-sbyd/jsx-dev-runtime";
import Form from "next-xss-sbyd/compat/form";
import {sanitizeUserHtml} from "next-xss-sbyd/sanitize-node";

const sinks = [
  ["a", "href"], ["area", "href"], ["audio", "src"], ["button", "formAction"],
  ["form", "action"], ["img", "src"], ["input", "src"], ["input", "formAction"],
  ["source", "src"], ["track", "src"], ["video", "src"], ["video", "poster"],
];
const urls = [
  ["/a/../target", "/target"],
  ["HTTPS://Example.TEST:443/submit", "https://example.test/submit"],
  ["http://example.test/submit", "http://example.test/submit"],
  ["mailto:user@example.test", "mailto:user@example.test"],
  ["tel:+15551234", "tel:+15551234"],
];

test("all passive sinks share the same string policy in every JSX entry point", () => {
  for (const factory of [jsx, jsxs, jsxDEV, api.createElement]) {
    for (const [tag, prop] of sinks) {
      for (const [value, expected] of urls) {
        const element = factory(tag, {[prop]: value});
        assert.equal(element.props[prop], expected, `${tag}.${prop}: ${value}`);
        assert.ok(renderToStaticMarkup(element).includes(expected));
      }
      for (const value of ["javascript:alert(1)", "data:text/html,bad", "blob:https://example.test/id", "//evil.test/x"]) {
        assert.throws(() => factory(tag, {[prop]: value}), /Invalid URL/);
      }
      for (const value of [null, undefined]) assert.equal(factory(tag, {[prop]: value}).props[prop], value);
    }
  }
});

test("only form action props accept functions after validator unification", () => {
  async function submit() {}
  for (const [tag, prop] of sinks) {
    if (prop === "action" || prop === "formAction") {
      assert.equal(jsx(tag, {[prop]: submit}).props[prop], submit);
    } else {
      assert.throws(() => jsx(tag, {[prop]: submit}), /requires a string/);
    }
  }
  assert.throws(() => jsx("img", {srcSet: submit}), /requires a string/);
  assert.match(renderToStaticMarkup(jsx(Form, {action: "HTTPS://Example.TEST:443/submit"})), /action="https:\/\/example.test\/submit"/);
  assert.doesNotThrow(() => renderToStaticMarkup(jsx(Form, {action: submit})));
});

test("every srcSet candidate uses the common URL checker", () => {
  for (const tag of ["img", "source"]) {
    assert.equal(jsx(tag, {srcSet: "mailto:user@example.test 1x, tel:+15551234 2x"}).props.srcSet,
      "mailto:user@example.test 1x, tel:+15551234 2x");
    for (const srcSet of ["/safe.png 1x, javascript:alert(1) 2x", "javascript:alert(1) 1x, /safe.png 2x"]) {
      assert.throws(() => jsx(tag, {srcSet}), /Invalid URL/);
    }
  }
});

test("sanitized links and media share canonicalization and scheme validation", async () => {
  for (const [value, expected] of urls) {
    for (const [tag, prop] of [["a", "href"], ["img", "src"], ["audio", "src"], ["video", "src"], ["video", "poster"]]) {
      const output = await new api.SafeResponse(sanitizeUserHtml(`<${tag} ${prop}="${value}"></${tag}>`)).text();
      assert.ok(output.includes(`${prop}="${expected}"`), output);
    }
  }
});

test("ordinary URL strings cannot authorize any active-content sink", () => {
  const value = api.validateUrl("https://example.test/content");
  for (const [tag, prop, other] of [
    ["script", "src"], ["iframe", "src"], ["frame", "src"], ["embed", "src"],
    ["object", "data"], ["link", "href", {rel: "stylesheet"}],
    ["use", "href"], ["image", "xlinkHref"], ["feimage", "href"],
  ]) assert.throws(() => jsx(tag, {[prop]: value, ...other}), /TrustedScriptUrl/);
});

test("withQuery validates plain input before URL parsing can erase unsafe syntax", () => {
  assert.equal(api.withQuery("/search", {q: api.queryValue("one two")}), "/search?q=one+two");
  for (const value of ["https://example.test/\npath", "/ok\\bad", "relative/path", "//example.test/path", "javascript:alert(1)"]) {
    assert.throws(() => api.withQuery(value, {}), /Invalid URL/);
  }
});
