import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

import {createElement as reactCreateElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createElement, htmlEscape, SafeAnchor, SafeLink, trustedScriptUrl} from "next-xss-sbyd";
import {jsx, jsxs} from "next-xss-sbyd/jsx-runtime";
import {jsxDEV} from "next-xss-sbyd/jsx-dev-runtime";
import Form from "next-xss-sbyd/compat/form";
import Image from "next-xss-sbyd/compat/image";
import Link from "next-xss-sbyd/compat/link";
import {guardJsxProps} from "../packages/next-xss-sbyd/dist/jsx-guard.js";

test("the JSX runtime validates and canonicalizes every passive intrinsic URL sink", () => {
  const element = jsxs("main", {
    children: [
      jsx("a", {href: "HTTPS://Example.COM:443/a", children: "link"}),
      jsx("area", {href: "/map/../target"}),
      jsx("img", {src: "/images/../avatar.png", srcSet: "/small.png 1x, /large.png 2x"}),
      jsx("source", {src: "/media/../movie.mp4", srcSet: "/movie.mp4 1x"}),
      jsx("audio", {src: "/audio/../clip.mp3"}),
      jsx("video", {src: "/video/../clip.mp4", poster: "/images/../poster.png"}),
      jsx("track", {src: "/captions/../en.vtt"}),
      jsx("input", {src: "/buttons/../submit.png", formAction: "/actions/../submit"}),
      jsx("button", {type: "submit", formAction: "/actions/../save", children: "save"}),
      jsx("form", {action: "/actions/../submit"}),
    ],
  });
  const output = renderToStaticMarkup(element);
  assert.match(output, /href="https:\/\/example.com\/a"/);
  assert.match(output, /href="\/target"/);
  assert.match(output, /src="\/avatar.png"/);
  assert.match(output, /srcSet="\/small.png 1x, \/large.png 2x"/);
  assert.match(output, /poster="\/poster.png"/);
  assert.match(output, /formAction="\/submit"/);
  assert.match(output, /formAction="\/save"/);
  assert.match(output, /action="\/submit"/);
});

test("passive URL sinks fail closed for direct props and resolved spreads", () => {
  for (const [type, props] of [
    ["a", {href: "javascript:alert(1)"}],
    ["img", {src: "data:text/html,<script>alert(1)</script>"}],
    ["img", {srcSet: "/safe.png 1x, javascript:alert(1) 2x"}],
    ["form", {action: "javascript:alert(1)"}],
  ]) assert.throws(() => jsx(type, props), /Invalid URL|Invalid srcSet/u);
});

test("active-content sinks unwrap only authentic TrustedScriptUrl values", () => {
  const trusted = trustedScriptUrl`https://cdn.example.test/app.js`;
  assert.equal(renderToStaticMarkup(jsx("script", {src: trusted})), '<script src="https://cdn.example.test/app.js"></script>');
  assert.equal(renderToStaticMarkup(jsx("iframe", {src: trusted})), '<iframe src="https://cdn.example.test/app.js"></iframe>');
  assert.equal(renderToStaticMarkup(jsx("link", {rel: "stylesheet", href: trusted})), '<link rel="stylesheet" href="https://cdn.example.test/app.js"/>');
  assert.equal(renderToStaticMarkup(jsx("svg", {children: jsx("use", {href: trusted})})), '<svg><use href="https://cdn.example.test/app.js"></use></svg>');
  for (const [type, props] of [
    ["script", {src: "/app.js"}],
    ["iframe", {src: "/frame"}],
    ["object", {data: "/movie.swf"}],
    ["link", {rel: "stylesheet", href: "/app.css"}],
    ["use", {href: "/icons.svg#menu"}],
  ]) assert.throws(() => jsx(type, props), /TrustedScriptUrl/u);
});

test("the JSX runtime forbids document-security rewrites", () => {
  assert.throws(() => jsx("base", {href: "/rewritten/"}), /forbidden.*base/u);
  assert.throws(() => jsx("meta", {httpEquiv: "refresh", content: "0;url=/login"}), /forbidden.*meta refresh/u);
});

test("base href checks inspect every case-insensitive prop match", () => {
  assert.throws(
    () => jsx("base", {href: undefined, HREF: "/rewritten/"}),
    /forbidden.*base/u,
  );
});

test("meta refresh checks inspect every case-insensitive prop match", () => {
  assert.throws(
    () => jsx("meta", {
      httpEquiv: undefined,
      HTTPEQUIV: "refresh",
      content: "0;url=https://evil.example/",
    }),
    /forbidden.*meta refresh/u,
  );
});

for (const [name, type, props, expected] of [
  ["form action", "form", {action: new URL("https://evil.example/collect")}, /action.*string/u],
  ["navigation URL", "a", {href: new URL("ftp://evil.example/file")}, /href.*string/u],
  ["srcSet", "img", {srcSet: {toString: () => "/safe.png 1x, javascript:alert(1) 2x"}}, /srcSet/u],
]) {
  test(`${name} sinks reject non-string values that React would stringify`, () => {
    assert.throws(() => jsx(type, props), expected);
  });
}

test("form action sinks preserve React function actions", () => {
  async function submit(_formData) {}
  for (const [tag, prop] of [["form", "action"], ["button", "formAction"], ["input", "formAction"]]) {
    assert.doesNotThrow(() => jsx(tag, {[prop]: submit}));
  }
});

test("meta refresh rejects non-string values that React would stringify", () => {
  assert.throws(
    () => jsx("meta", {
      httpEquiv: ["refresh"],
      content: "0;url=https://evil.example/",
    }),
    /forbidden.*meta refresh/u,
  );
});

test("root createElement applies the same validation and preserves children", () => {
  assert.equal(
    renderToStaticMarkup(createElement("a", {href: "/one/../two"}, "two")),
    '<a href="/two">two</a>',
  );
  assert.throws(() => createElement("img", {src: "javascript:alert(1)"}), /Invalid URL/u);
  assert.equal(renderToStaticMarkup(createElement("section", null, "plain")), renderToStaticMarkup(reactCreateElement("section", null, "plain")));
});

test("the development JSX runtime applies the same validation", () => {
  assert.equal(renderToStaticMarkup(jsxDEV("a", {href: "/one/../two", children: "two"}, undefined, false)), '<a href="/two">two</a>');
  assert.throws(() => jsxDEV("script", {src: "/app.js"}, undefined, false), /TrustedScriptUrl/u);
});

test("every JSX factory rejects unauthenticated raw-HTML props", () => {
  const unsafe = {dangerouslySetInnerHTML: {__html: "<img src=x onerror=alert(1)>"}};
  for (const factory of [
    () => jsx("div", unsafe),
    () => jsxs("div", {...unsafe, children: []}),
    () => jsxDEV("div", unsafe, undefined, false),
    () => createElement("div", unsafe),
  ]) assert.throws(factory, /dangerouslySetInnerHTML.*SafeHtml/u);

  for (const props of [
    {dangerouslysetinnerhtml: {__html: "unsafe"}},
    {DangerouslySetInnerHTML: {__html: "unsafe"}},
    {dangerouslyFutureHtml: "unsafe"},
    {srcdoc: "<script>alert(1)</script>"},
    {SRCDOC: "<script>alert(1)</script>"},
  ]) assert.throws(() => jsx("div", props), /SafeHtml/u);
});

test("the JSX guard authenticates and unwraps SafeHtml without changing benign props", () => {
  const safe = htmlEscape("<b>safe</b>");
  assert.equal(
    renderToStaticMarkup(jsx("section", {dangerouslySetInnerHTML: {__html: safe}})),
    "<section>&lt;b&gt;safe&lt;/b&gt;</section>",
  );
  assert.equal(renderToStaticMarkup(jsx("iframe", {srcDoc: safe})), '<iframe srcDoc="&amp;lt;b&amp;gt;safe&amp;lt;/b&amp;gt;"></iframe>');
  const benign = {id: "same", children: "content"};
  assert.strictEqual(jsx("div", benign).props, benign);

  const reused = {srcDoc: safe, SRCDOC: safe, title: "keep"};
  const guarded = jsx("iframe", reused);
  assert.equal(guarded.props.srcDoc, "&lt;b&gt;safe&lt;/b&gt;");
  assert.equal(guarded.props.SRCDOC, "&lt;b&gt;safe&lt;/b&gt;");
  assert.strictEqual(reused.srcDoc, safe, "the caller's props object must not be mutated");
  assert.strictEqual(reused.SRCDOC, safe, "the caller's second safe value must not be mutated");
});

test("forwarding components preserve SafeHtml until it reaches an intrinsic sink", () => {
  const safe = htmlEscape("<b>safe</b>");
  function Frame(props) {
    return jsx("iframe", props);
  }
  function Html(props) {
    return jsx("section", props);
  }

  assert.equal(
    renderToStaticMarkup(jsx(Frame, {srcDoc: safe})),
    '<iframe srcDoc="&amp;lt;b&amp;gt;safe&amp;lt;/b&amp;gt;"></iframe>',
  );
  assert.equal(
    renderToStaticMarkup(jsx(Html, {dangerouslySetInnerHTML: {__html: safe}})),
    "<section>&lt;b&gt;safe&lt;/b&gt;</section>",
  );
});

test("first-party forwarding wrappers authenticate raw HTML props", () => {
  const forwarded = {dangerouslySetInnerHTML: {__html: "<script>alert(1)</script>"}};
  for (const Component of [SafeAnchor, SafeLink]) {
    assert.throws(() => renderToStaticMarkup(jsx(Component, {href: "/safe", ...forwarded})), /SafeHtml/u);
  }
});

test("nullish raw-HTML props are treated as absent by every JSX factory", () => {
  for (const factory of [
    () => jsx("iframe", {srcDoc: undefined}),
    () => jsxs("iframe", {srcDoc: null, children: []}),
    () => jsxDEV("div", {dangerouslySetInnerHTML: undefined}, undefined, false),
    () => createElement("div", {dangerouslySetInnerHTML: null}),
  ]) assert.doesNotThrow(factory);
});

test("raw-HTML violations identify components without disclosing their source", () => {
  function BigComponent() {
    return jsx("div", {children: "implementation secret"});
  }
  assert.throws(
    () => guardJsxProps(BigComponent, {dangerouslySetInnerHTML: {__html: "unsafe"}}),
    (error) => {
      assert.match(error.message, /<BigComponent>/u);
      assert.doesNotMatch(error.message, /implementation secret|function BigComponent/u);
      return true;
    },
  );
});

test("documentation does not promise a nonexistent safeSpreadProps helper", async () => {
  const caveats = await readFile(new URL("../docs/caveats.md", import.meta.url), "utf8");
  const retrofit = await readFile(new URL("../docs/retrofit.md", import.meta.url), "utf8");
  assert.doesNotMatch(caveats, /safeSpreadProps/u);
  assert.doesNotMatch(retrofit, /safeSpreadProps/u);
});

test("already canonical URL values can be validated repeatedly", () => {
  const first = jsx("a", {href: "https://EXAMPLE.test:443/a"});
  const second = jsx("a", {href: first.props.href});
  assert.equal(second.props.href, "https://example.test/a");
});

test("compat Next components validate strings and preserve StaticImport objects", () => {
  assert.equal(renderToStaticMarkup(reactCreateElement(Link, {href: "/one/../two"}, "two")), '<a href="/two">two</a>');
  assert.match(renderToStaticMarkup(reactCreateElement(Image, {src: "/one/../avatar.png", alt: "", width: 16, height: 16})), /src="\/_next\/image\?url=%2Favatar.png/u);
  assert.equal(renderToStaticMarkup(reactCreateElement(Form, {action: "/one/../save"}, "save")), '<form action="/save">save</form>');
  assert.throws(() => renderToStaticMarkup(reactCreateElement(Link, {href: "javascript:alert(1)"}, "bad")), /Invalid URL/u);
  assert.throws(() => renderToStaticMarkup(reactCreateElement(Image, {src: "data:text/html,bad", alt: "", width: 16, height: 16})), /Invalid URL/u);
  const staticImport = {src: "/static.png", width: 16, height: 16};
  assert.doesNotThrow(() => renderToStaticMarkup(reactCreateElement(Image, {src: staticImport, alt: ""})));
  const href = {pathname: "/one/../two", query: {q: "javascript:alert(1)"}, hash: "section"};
  assert.match(renderToStaticMarkup(reactCreateElement(Link, {href}, "object")), /href="\/two\?q=javascript%3Aalert%281%29#section"/u);
  assert.throws(() => renderToStaticMarkup(reactCreateElement(Link, {href: {pathname: "javascript:alert(1)"}}, "bad")), /Invalid URL/u);
  assert.throws(() => renderToStaticMarkup(reactCreateElement(Link, {href: {protocol: "javascript:", pathname: "/alert(1)"}}, "bad")), /protocol is not allowed/u);
  assert.throws(() => renderToStaticMarkup(reactCreateElement(Link, {href: {hostname: "evil.example", pathname: "/login"}}, "bad")), /hostname is not allowed/u);
});

test("intrinsic matching is case-insensitive and malformed srcSet values fail closed", () => {
  assert.equal(jsx("A", {href: "/one/../two"}).props.href, "/two");
  assert.equal(jsx("a", {HREF: "/one/../two"}).props.HREF, "/two");
  assert.throws(() => jsx("base", {HREF: "/rewritten/"}), /forbidden.*base/u);
  assert.throws(() => jsx("iframe", {srcdoc: "<script>alert(1)</script>"}), /SafeHtml/u);
  assert.throws(() => jsx("script", {SRC: "/app.js"}), /TrustedScriptUrl/u);
  for (const srcSet of ["", "/a.png 0w", "/a.png 1.5w", "/a.png 1x 2x", "/a.png,"]) {
    assert.throws(() => jsx("img", {srcSet}), /Invalid srcSet/u);
  }
});
