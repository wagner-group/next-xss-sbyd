import assert from "node:assert/strict";
import test from "node:test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {JSDOM} from "jsdom";
import {SafeBlock} from "next-xss-sbyd";
import {sanitizeUserHtml} from "next-xss-sbyd/sanitize-node";

function display(dirty) {
  const markup = renderToStaticMarkup(createElement(SafeBlock, {html: sanitizeUserHtml(dirty)}));
  return new JSDOM(markup).window.document.body.firstElementChild;
}

test("issue217 retains structure, media, text and canonical per-element attributes through SafeBlock", () => {
  const root = display(`<div title="Warning: hot" aria-label="Warning: hot"><span><mark data-highlight-id="secret">mark</mark></span>
    <figure><img src="/a.png" alt="Picture: snow" width="00012" height="10000"><figcaption>caption</figcaption></figure>
    <sub>sub</sub><sup>sup</sup><dl><dt>term</dt><dd>definition</dd></dl>
    <table><tbody><tr><th scope="row" abbr="Warning: hot" colspan="001" rowspan="1000">cell</th></tr></tbody></table>
    <audio src="/a.wav" autoplay loop preload="auto"><source src="/a.ogg" type="audio/ogg"><a href="/a.wav">download</a></audio>
    <video src="https://EXAMPLE.test/v.webm" poster="/poster.png" width="100" height="200"></video></div>`);
  assert.equal(root.querySelector("div").getAttribute("aria-label"), "Warning: hot");
  assert.equal(root.querySelector("div").title, "Warning: hot");
  for (const tag of ["span", "mark", "figure", "figcaption", "sub", "sup", "dl", "dt", "dd", "img", "audio", "video", "source"]) assert.ok(root.querySelector(tag), tag);
  assert.equal(root.querySelector("img").alt, "Picture: snow");
  assert.equal(root.querySelector("img").getAttribute("width"), "12");
  assert.equal(root.querySelector("img").getAttribute("referrerpolicy"), "no-referrer");
  assert.equal(root.querySelector("th").getAttribute("abbr"), "Warning: hot");
  assert.equal(root.querySelector("th").getAttribute("colspan"), "1");
  assert.equal(root.querySelector("a").rel, "nofollow noopener noreferrer");
  assert.equal(root.querySelector("video").getAttribute("src"), "https://example.test/v.webm");
  for (const media of root.querySelectorAll("audio, video")) {
    assert.equal(media.hasAttribute("controls"), true);
    assert.equal(media.getAttribute("preload"), "none");
    assert.equal(media.hasAttribute("autoplay"), false);
    assert.equal(media.hasAttribute("loop"), false);
  }
  assert.equal(root.querySelector("[data-highlight-id]"), null);
});

test("issue217 rejects DOMPurify URL exceptions and invalid source elements", () => {
  const root = display(`<img src="data:image/svg+xml,evil" alt="retained"><video src="blob:https://example.test/id" poster="javascript:alert(1)"></video>
    <audio><source src="data:audio/wav,evil"><source><source src="/ok.wav" type="audio/wav"></audio>
    <div><source src="/orphan.wav"></div>`);
  assert.equal(root.querySelector("img").hasAttribute("src"), false);
  assert.equal(root.querySelector("img").alt, "retained");
  assert.equal(root.querySelector("video").hasAttribute("src"), false);
  assert.equal(root.querySelector("video").hasAttribute("poster"), false);
  assert.equal(root.querySelectorAll("source").length, 1);
  assert.equal(root.querySelector("source").getAttribute("src"), "/ok.wav");
});

test("issue217 rejects extra arguments and non-string inputs without coercion", () => {
  for (const input of [undefined, null, {}, 1, true, new String("html")]) {
    assert.throws(() => sanitizeUserHtml(input), /string/i);
  }
  for (const extra of [undefined, {}, null]) assert.throws(() => sanitizeUserHtml("<p>safe</p>", extra), /one|argument/i);
});

test("issue217 enforces per-element attributes and strips imported identity on every element", () => {
  const root = display(`<p href="/no" src="/no" alt="no" width="12" type="audio/wav" scope="row" abbr="no" colspan="2">p</p>
    <a src="/no" poster="/no" href="/yes" target="_blank" rel="opener" download ping="/ping">link</a>
    <audio poster="/no" width="12" height="12"><source src="/yes" width="12" alt="no"></audio>
    <table><tr><td href="/no" src="/no" headers="outside" aria-describedby="outside">cell</td></tr></table>`);
  assert.equal(root.querySelector("p").attributes.length, 0);
  assert.deepEqual(root.querySelector("a").getAttributeNames().sort(), ["href", "rel"]);
  assert.deepEqual(root.querySelector("audio").getAttributeNames().sort(), ["controls", "preload"]);
  assert.deepEqual(root.querySelector("source").getAttributeNames(), ["src"]);
  assert.equal(root.querySelector("td").attributes.length, 0);
  const tags = ["a", "b", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "ol", "p", "pre", "s", "strong", "u", "ul", "div", "span", "figure", "figcaption", "mark", "sub", "sup", "dl", "dt", "dd", "img", "audio", "video"];
  for (const tag of tags) {
    const clean = display(`<${tag} id="outside" name="attributes" data-test="x" data-highlight-id="record" aria-describedby="outside" aria-hidden="true" class="x" style="color:red" onclick="alert(1)" title="a: b" aria-label="a: b"></${tag}>`).querySelector(tag);
    assert.ok(clean, tag);
    assert.equal(clean.getAttribute("title"), "a: b", tag);
    assert.equal(clean.getAttribute("aria-label"), "a: b", tag);
    for (const name of clean.getAttributeNames()) assert.ok(["title", "aria-label", "referrerpolicy", "controls", "preload"].includes(name), `${tag} ${name}`);
  }
});

test("issue217 validates integer bounds against untrimmed parsed input", () => {
  for (const [tag, attr, max] of [["img", "width", 10000], ["img", "height", 10000], ["video", "width", 10000], ["video", "height", 10000], ["td", "colspan", 1000], ["th", "rowspan", 1000]]) {
    for (const value of ["1", "0002", String(max), "0", "-1", "+1", "1.5", "1e2", "2px", " 2", "2 ", "2\t", "", String(max + 1), "9".repeat(400), "١", "&#32;2", "1&#10;"]) {
      const html = `<${tag} ${attr}="${value}">text</${tag}>`;
      const input = tag === "td" || tag === "th" ? `<table><tr>${html}</tr></table>` : html;
      const node = display(input).querySelector(tag);
      const expected = ["1", "0002", String(max)].includes(value) ? String(Number(value)) : null;
      assert.equal(node.getAttribute(attr), expected, `${tag} ${attr}=${JSON.stringify(value)}`);
    }
  }
});

test("issue217 restricts scope and source MIME values without trimming or URI-safe bypasses", () => {
  for (const scope of ["row", "col", "rowgroup", "colgroup", "ROW", "row ", "row:evil", "bogus", ""]) {
    const td = display(`<table><tr><td scope="${scope}">x</td></tr></table>`).querySelector("td");
    assert.equal(td.getAttribute("scope"), ["row", "col", "rowgroup", "colgroup"].includes(scope) ? scope : null);
  }
  const accepted = ["audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/webm", "video/mp4", "video/ogg", "video/webm"];
  for (const type of [...accepted, "text/html", "audio/WAV", "audio/wav ", "video/webm; codecs=vp8", "javascript:evil", ""]) {
    const source = display(`<video><source src="/safe" type="${type}"></video>`).querySelector("source");
    assert.equal(source.getAttribute("type"), accepted.includes(type) ? type : null, type);
  }
});

test("issue217 revalidates every URL sink after parsing and uses canonical output", () => {
  const invalid = ["javascript:alert(1)", "jAvA&#x73;cript:alert(1)", "java&#9;script:alert(1)", "data:image/svg+xml,x", "blob:https://example.test/x", "//evil.test/x", "https://user:pass@example.test/", "relative.png", "#anchor", "https:\\evil.test/x", " /safe", "/safe ", "/a&#10;b", "", "https://["];
  const resourceOnlyInvalid = ["mailto:user@example.test", "tel:+15551234"];
  const valid = [["/a/../b?a=1&amp;b=2", "/b?a=1&b=2"], ["https://EXAMPLE.test:443/a/../b", "https://example.test/b"], ["http://example.test/a", "http://example.test/a"]];
  for (const [tag, attr] of [["a", "href"], ["img", "src"], ["audio", "src"], ["video", "src"], ["video", "poster"], ["source", "src"]]) {
    const cases = [...invalid.map(value => [value, null]), ...valid, ...resourceOnlyInvalid.map(value => [value, tag === "a" ? value : null])];
    for (const [value, expected] of cases) {
      const fragment = `<${tag} ${attr}="${value}">text</${tag}>`;
      const node = display(tag === "source" ? `<audio>${fragment}</audio>` : fragment).querySelector(tag);
      if (tag === "source" && expected === null) assert.equal(node, null, value);
      else {
        assert.equal(node.getAttribute(attr), expected, `${tag} ${attr}=${value}`);
        if (tag === "a") assert.equal(node.getAttribute("rel"), expected === null ? null : "nofollow noopener noreferrer");
      }
    }
  }
});

test("issue217 authenticated results survive display but not copying or JSON transport", () => {
  const safe = sanitizeUserHtml("<mark>safe</mark>");
  assert.match(renderToStaticMarkup(createElement(SafeBlock, {html: safe})), /<mark>safe<\/mark>/);
  for (const value of ["<b>raw</b>", {...safe}, JSON.parse(JSON.stringify(safe)), {privateDoNotAccessOrElseSafeHtmlWrappedValue: "<script>evil</script>"}]) {
    assert.throws(() => renderToStaticMarkup(createElement(SafeBlock, {html: value})), /unwrap SafeHtml/);
  }
  assert.equal(display("").textContent, "");
  assert.equal(display("<script>evil</script>").textContent, "");
  assert.equal(display("ordinary text").textContent, "ordinary text");
});

// Exhausted memory or a damaged DOM engine can make the private engine throw or
// violate its return contract. Triggering those Node-only failures requires test
// doubles or destabilizing the process; no original-input fallback exists.

test("issue217 conditional adapters import safely and fail clearly without a DOM or on Edge", async () => {
  const {execFile} = await import("node:child_process");
  const {promisify} = await import("node:util");
  const run = promisify(execFile);
  for (const [conditions, error] of [[['browser'], 'workers without a DOM'], [['edge-light'], 'Edge'], [['edge-light', 'browser'], 'Edge']]) {
    const program = `
      import assert from 'node:assert/strict';
      import {sanitizeUserHtml} from 'next-xss-sbyd/sanitize';
      assert.throws(() => sanitizeUserHtml('<p>unsafe input</p>'), /${error}/);
      assert.throws(() => sanitizeUserHtml(null), /string/);
      assert.throws(() => sanitizeUserHtml('html', {}), /argument/);
      console.log('imported and rejected');
    `;
    const {stdout} = await run(process.execPath, [...conditions.map(condition => `--conditions=${condition}`), '--input-type=module', '-e', program], {cwd: new URL('../', import.meta.url)});
    assert.match(stdout, /imported and rejected/);
  }
});

test("issue217 judges source parents after unsupported ordinary wrappers are removed", () => {
  const root = display('<audio><section><source src="/kept.wav"></section><div><source src="/removed.wav"></div></audio>');
  assert.equal(root.querySelectorAll('source').length, 1);
  assert.equal(root.querySelector('source').getAttribute('src'), '/kept.wav');
  assert.equal(root.querySelector('source').parentElement.localName, 'audio');
});


test("issue218 explains direct callback rejection and supports one-argument map wrappers", () => {
  const articles = ["<p>first</p>", "<p>second<script>unsafe</script></p>"];
  assert.throws(() => articles.map(sanitizeUserHtml), /call sanitizeUserHtml\(dirty\) directly.*map\/forEach/);
  assert.throws(() => articles.forEach(sanitizeUserHtml), /call sanitizeUserHtml\(dirty\) directly.*map\/forEach/);
  const cleaned = articles.map(dirty => sanitizeUserHtml(dirty));
  const displayed = cleaned.map(html => new JSDOM(renderToStaticMarkup(createElement(SafeBlock, {html}))).window.document.body);
  assert.deepEqual(displayed.map(root => root.textContent), ["first", "second"]);
  for (const root of displayed) assert.equal(root.querySelector("script"), null);
});

test("issue218 documents removal of customized built-in elements and their children", () => {
  const root = display('<p is="x-y">removed<b>child</b></p><p>retained</p>');
  assert.equal(root.textContent, "retained");
  assert.equal(root.querySelectorAll("p").length, 1);
});
