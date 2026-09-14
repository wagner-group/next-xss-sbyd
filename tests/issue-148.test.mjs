import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import test from "node:test";
import {promisify} from "node:util";

const execFileAsync = promisify(execFile);
const root = new URL("../", import.meta.url);

test("standard response constructors reject safe HTML and direct callers to explicit safe sinks", async () => {
  const program = `
    import assert from "node:assert/strict";
    import {NextResponse} from "next/server.js";
    import {htmlEscape, SafeNextResponse, SafeResponse} from "next-xss-sbyd";
    import {safeRenderToReadableStream} from "next-xss-sbyd/render";

    const html = htmlEscape("<script>alert(1)</script>");
    const stream = await safeRenderToReadableStream("safe");
    const standardConstructorMessage = {
      name: "TypeError",
      message: "SafeHtml and SafeStream must be passed to SafeResponse or SafeNextResponse, not Response or NextResponse",
    };
    assert.throws(() => new Response(html), standardConstructorMessage);
    assert.throws(() => new NextResponse(html), standardConstructorMessage);
    assert.throws(() => new Response(stream), standardConstructorMessage);
    assert.throws(() => new NextResponse(stream), standardConstructorMessage);

    const response = new SafeResponse(html);
    assert.equal(await response.text(), "&lt;script&gt;alert(1)&lt;/script&gt;");
    assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");

    const nextResponse = new SafeNextResponse(html);
    nextResponse.cookies.set("session", "value", {httpOnly: true});
    assert.equal(await nextResponse.text(), "&lt;script&gt;alert(1)&lt;/script&gt;");
    assert.equal(nextResponse.cookies.get("session").value, "value");
  `;
  const {stderr} = await execFileAsync(process.execPath, [
    "--import", "next-xss-sbyd/enforce/preload", "--input-type=module", "--eval", program,
  ], {cwd: root, timeout: 30_000});
  assert.equal(stderr, "");
});
