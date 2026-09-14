import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import test from "node:test";
import {promisify} from "node:util";

const execFileAsync = promisify(execFile);

test("preload enforces Response and NextResponse before framework import", async () => {
  const program = `
    import assert from "node:assert/strict";
    import {createElement} from "react";
    import {NextResponse} from "next/server.js";
    import {htmlEscape, SafeNextResponse, SafeResponse} from "next-xss-sbyd";
    import {safeRenderToReadableStream} from "next-xss-sbyd/render";

    const safe = new SafeNextResponse(htmlEscape("<b>safe</b>"));
    assert.equal(await safe.text(), "&lt;b&gt;safe&lt;/b&gt;");
    assert.equal(safe.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(safe.headers.get("x-content-type-options"), "nosniff");
    assert.throws(() => new NextResponse("<h1>unsafe</h1>", {headers: {"Content-Type": "text/html"}}), /raw string response/i);

    const stream = await safeRenderToReadableStream(createElement("main", null, "streamed"));
    const streamed = new SafeResponse(stream);
    assert.equal(await streamed.text(), "<main>streamed</main>");
    assert.equal(streamed.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(streamed.headers.get("x-content-type-options"), "nosniff");
  `;
  const {stderr} = await execFileAsync(process.execPath, [
    "--import", "next-xss-sbyd/enforce/preload", "--input-type=module", "--eval", program,
  ]);
  assert.equal(stderr, "");
});
