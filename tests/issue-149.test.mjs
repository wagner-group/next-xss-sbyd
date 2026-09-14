import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import test from "node:test";
import {promisify} from "node:util";

const execFileAsync = promisify(execFile);
const root = new URL("../", import.meta.url);
const scenarios = [
  {name: "without guard", setup: "", preload: []},
  {name: "required preload", setup: "", preload: ["--import", "next-xss-sbyd/enforce/preload"]},
  {name: "instrumentation after safe imports", setup: `
    await import("next-xss-sbyd");
    (await import("next-xss-sbyd/enforce")).installResponseGuard();
  `, preload: []},
  {name: "NextResponse imported before guard, safe classes after", setup: `
    await import("next/server.js");
    (await import("next-xss-sbyd/enforce")).installResponseGuard();
  `, preload: []},
];

// Each startup order needs a new process: ESM caches classes and the guard is permanent.
for (const {name, setup, preload} of scenarios) {
  test(`safe response constructor boundary: ${name}`, async () => {
    const program = `
      import assert from "node:assert/strict";
      ${setup}
      const {createElement} = await import("react");
      const {NextResponse} = await import("next/server.js");
      const {htmlEscape, SafeResponse, SafeNextResponse} = await import("next-xss-sbyd");
      const {safeRenderToReadableStream} = await import("next-xss-sbyd/render");
      class AppResponse extends SafeResponse {}
      class AppNextResponse extends SafeNextResponse {}
      const payload = "<script>alert(1)</script>";
      const escaped = "&lt;script&gt;alert(1)&lt;/script&gt;";

      for (const Constructor of [SafeResponse, SafeNextResponse, AppResponse, AppNextResponse]) {
        const defaultResponse = new Constructor(htmlEscape(payload));
        assert.equal(await defaultResponse.text(), escaped);
        assert.equal(defaultResponse.headers.get("content-type"), "text/html; charset=utf-8");
        assert.equal(defaultResponse.headers.get("x-content-type-options"), "nosniff");
        for (const [body, expected] of [
          [htmlEscape(payload), escaped],
          [await safeRenderToReadableStream(createElement("p", null, payload)), "<p>" + escaped + "</p>"],
        ]) {
          const headers = new Headers({"x-test": "preserved"});
          const init = Object.freeze({headers, status: 201, statusText: "Created"});
          const response = new Constructor(body, init);
          assert.ok(response instanceof Constructor);
          assert.equal(response.status, 201);
          assert.equal(response.statusText, "Created");
          assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
          assert.equal(response.headers.get("x-content-type-options"), "nosniff");
          assert.equal(response.headers.get("x-test"), "preserved");
          assert.deepEqual([...headers], [["x-test", "preserved"]]);
          if (response instanceof NextResponse) {
            response.cookies.set("session", "value", {httpOnly: true});
            assert.equal(response.cookies.get("session").value, "value");
            assert.match(response.headers.get("set-cookie"), /session=value/);
          }
          const copy = response.clone();
          const text = await response.text();
          assert.equal(text, expected);
          assert.equal(await copy.text(), text);
          assert.equal(copy.headers.get("content-type"), "text/html; charset=utf-8");
          assert.equal(copy.headers.get("x-content-type-options"), "nosniff");
        }
        for (const headers of [
          {"Content-Type": "text/html; charset=utf-8"},
          [["cOnTeNt-TyPe", "text/javascript"]],
          new Headers({"X-Content-Type-Options": "nosniff"}),
          {"x-content-type-options": "off"},
        ]) {
          assert.throws(() => new Constructor(htmlEscape("safe"), {headers}), /cannot be overridden/);
          const stream = await safeRenderToReadableStream(createElement("p", null, "safe"));
          assert.throws(() => new Constructor(stream, {headers}), /cannot be overridden/);
        }
        const authenticStream = await safeRenderToReadableStream(createElement("p", null, "safe"));
        for (const body of [payload, "", null, undefined, {},
          Object.create(Object.getPrototypeOf(authenticStream)),
          {privateDoNotAccessOrElseWrappedHtml: payload},
          {allReady: Promise.resolve()}, new Uint8Array([60, 62]), new Blob([payload]),
          new ReadableStream({start(controller) { controller.close(); }}),
        ]) {
          assert.throws(() => new Constructor(body), TypeError);
          assert.throws(() => new Constructor(body, {headers: {"content-type": "text/plain"}}), TypeError);
        }
      }
      // The compatibility path must not relax the generic guard's raw-HTML policy.
      if ((await import("next-xss-sbyd/enforce")).isGuardInstalled()) {
        assert.throws(() => new Response(payload, {headers: {"content-type": "text/html"}}), TypeError);
      }
    `;
    const {stderr} = await execFileAsync(process.execPath, [
      ...preload, "--input-type=module", "--eval", program,
    ], {cwd: root, timeout: 30_000});
    assert.equal(stderr, "");
  });
}
