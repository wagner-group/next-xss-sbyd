import assert from "node:assert/strict";
import test from "node:test";

import {SafeResponse} from "next-xss-sbyd";
import {sanitizeUserHtml} from "next-xss-sbyd/sanitize-node";

async function sanitize(input) {
  return new SafeResponse(sanitizeUserHtml(input)).text();
}

test("formatting retains the original structural elements", async () => {
  const input = `<h2>Title</h2><p><strong>bold</strong> <em>em</em> <code>code</code><br></p>
    <blockquote><pre>pre</pre></blockquote><ol><li>one</li></ol><ul><li>two</li></ul>
    <table><caption>C</caption><thead><tr><th scope="col">H</th></tr></thead>
    <tbody><tr><td colspan="2" rowspan="3" aria-label="cell">D</td></tr></tbody></table>`;
  assert.equal(await sanitize(input), input);
});

test("scripts, active content, styles, namespaces, custom elements, and clobbering names are removed", async () => {
  const dirty = `<script>alert(1)</script><style>body{display:none}</style>
    <p style="color:red" onclick="alert(1)" id="x" name="y">safe</p>
    <form><input name="attributes"></form><base href="https://evil.test/">
    <iframe srcdoc="<script>alert(1)</script>"></iframe><img src="x" onerror="alert(1)">
    <svg><a xlink:href="javascript:alert(1)">svg</a></svg><math><mi>math</mi></math>
    <template><img src=x onerror=alert(1)></template><x-evil data-x="1">custom</x-evil>`;
  assert.equal(await sanitize(dirty), `<p>safe</p>\n    \n    <img referrerpolicy="no-referrer">\n    \n    custom`);
});

test("anchor URLs are revalidated and all valid links get a fixed rel", async () => {
  const dirty = `<a href="javascript:alert(1)" title="bad">bad</a>
    <a href="/docs" rel="opener">local</a>
    <a href="https://example.test/a" target="_blank">external</a>
    <a href="mailto:user@example.test">mail</a>`;
  assert.equal(await sanitize(dirty), `<a title="bad">bad</a>\n    <a href="/docs" rel="nofollow noopener noreferrer">local</a>\n    <a href="https://example.test/a" rel="nofollow noopener noreferrer">external</a>\n    <a href="mailto:user@example.test" rel="nofollow noopener noreferrer">mail</a>`);
});

test("mutation-XSS corpus and malformed tables serialize inertly", async () => {
  const payloads = [
    `<math><mtext><table><mglyph><style><!--</style><img title="--><img src=1 onerror=alert(1)>">`,
    `<svg></p><style><g title="</style><img src onerror=alert(1)>">`,
    `<TABLE><tr><td>HELLO</tr></TABL>`,
    `<a href="jAva&Tab;script:alert(1)">bad</a>`,
  ];
  for (const payload of payloads) {
    const output = await sanitize(payload);
    assert.doesNotMatch(output, /onerror|<style|<svg|<math|javascript/i, payload);
  }
});

test("the Node alias uses the universal one-argument API", async () => {
  const universal = await import("next-xss-sbyd/sanitize");
  assert.equal(universal.sanitizeUserHtml, sanitizeUserHtml);
  assert.deepEqual(Object.keys(universal), ["sanitizeUserHtml"]);
  assert.throws(() => sanitizeUserHtml("<p>ok</p>", {name: "inert-rich-text"}), /argument/i);
});
