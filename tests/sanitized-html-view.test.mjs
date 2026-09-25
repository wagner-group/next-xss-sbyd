import assert from "node:assert/strict";
import {test} from "node:test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {SafeBlock, htmlEscape} from "next-xss-sbyd";
import {sanitizeUserHtml} from "next-xss-sbyd/sanitize";
import {SanitizedHtmlView} from "next-xss-sbyd/sanitized-html-view";

const tags = ["article", "aside", "div", "footer", "header", "main", "nav", "section", "span"];
const values = ["", "plain & text", '<b>bold</b><em>emphasis</em><script>alert(1)</script><img src="javascript:alert(1)" onerror="alert(1)">', '<a href="/safe" target="_blank">link</a><mark data-highlight-id="forged">marked</mark>'];

test("SSR uses exactly the existing sanitizer policy and presentation props on each render", () => {
  for (const as of [undefined, ...tags]) {
    for (const value of [...values, ...values]) {
      const props = {as, id: "content", className: "prose", title: "Preview", "aria-label": "Content", style: {color: "red"}};
      assert.equal(renderToStaticMarkup(createElement(SanitizedHtmlView, {...props, value})),
        renderToStaticMarkup(createElement(SafeBlock, {...props, html: sanitizeUserHtml(value)})));
    }
  }
});

test("forged spreads cannot replace the sanitized content", () => {
  for (const name of ["children", "Children", "html", "HTML", "innerHTML", "dangerouslySetInnerHTML", "DangerouslyAnything", "VALUE"]) {
    assert.throws(() => renderToStaticMarkup(createElement(SanitizedHtmlView, {
      value: "<b>safe</b>", [name]: name === "dangerouslySetInnerHTML" ? {__html: "<script>bad</script>"} : "unsafe",
    })), /Unsafe SanitizedHtmlView prop/);
  }
  for (const as of ["script", "style", "iframe", "textarea", "svg", null]) {
    assert.throws(() => renderToStaticMarkup(createElement(SanitizedHtmlView, {as, value: "text"})), /Unsafe SafeBlock container/);
  }
});

test("input failures propagate and subsequent renders recover", () => {
  for (const value of [undefined, null, {}, 1, htmlEscape("safe")]) {
    assert.throws(() => renderToStaticMarkup(createElement(SanitizedHtmlView, {value})), /requires a string/);
  }
  const deep = "<div>".repeat(600) + "text" + "</div>".repeat(600);
  assert.throws(() => renderToStaticMarkup(createElement(SanitizedHtmlView, {value: deep})), /depth/i);
  assert.equal(renderToStaticMarkup(createElement(SanitizedHtmlView, {value: ""})), "<div></div>");
  assert.equal(renderToStaticMarkup(createElement(SanitizedHtmlView, {value: "<b>recovered</b>"})), "<div><b>recovered</b></div>");
});

test("server-component export renders without client APIs and rejects refs", async () => {
  const {SanitizedHtmlView: ServerView} = await import("../packages/next-xss-sbyd/dist/sanitized-html-view-server.js");
  assert.equal(renderToStaticMarkup(createElement(ServerView, {value: "<b>server</b><script>bad</script>"})), "<div><b>server</b></div>");
  assert.throws(() => renderToStaticMarkup(createElement(ServerView, {value: "", ref: null})), /refs require a client component/);
  const {spawnSync} = await import("node:child_process");
  const result = spawnSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import {SanitizedHtmlView} from "next-xss-sbyd/sanitized-html-view";
    const view = SanitizedHtmlView({value: "<b>server</b><script>bad</script>"});
    assert.equal(view.type, "div");
    assert.equal(String(view.props.dangerouslySetInnerHTML.__html), "<b>server</b>");
    assert.throws(() => SanitizedHtmlView({value: "", ref: null}), /refs require a client component/);
  `], {encoding: "utf8"});
  assert.equal(result.status, 0, result.stdout + result.stderr);
});


test("SafeBlock still rejects copied and serialized branded objects", () => {
  const clean = sanitizeUserHtml("<b>safe</b>");
  for (const html of [{...clean}, JSON.parse(JSON.stringify(clean))]) {
    assert.throws(() => renderToStaticMarkup(createElement(SafeBlock, {html})), /Could not unwrap SafeHtml/);
  }
  assert.equal(renderToStaticMarkup(createElement(SafeBlock, {html: clean})), "<div><b>safe</b></div>");
});
