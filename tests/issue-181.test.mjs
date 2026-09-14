import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import test from "node:test";
import {promisify} from "node:util";

const execFileAsync = promisify(execFile);

// A fresh process ensures the mandatory preload runs before Next imports Response.
test("preloaded Response preserves native factories and strict subclass identity", async () => {
  const program = `
    import assert from "node:assert/strict";
    import {NextResponse} from "next/server.js";
    import {htmlEscape, SafeResponse, SafeNextResponse} from "next-xss-sbyd";

    class AppResponse extends Response {}
    class AppNextResponse extends NextResponse {}
    class AppSafeResponse extends SafeResponse {}
    class AppSafeNextResponse extends SafeNextResponse {}

    const json = Response.json({error: "invalid format"}, {status: 400});
    const redirect = Response.redirect("https://example.test/export", 307);
    const error = Response.error();
    const plain = new Response("ok");
    const fetched = await fetch("data:text/plain,fetched");
    for (const response of [json, redirect, error, plain, fetched, plain.clone()]) {
      assert.ok(response instanceof Response);
      for (const Constructor of [NextResponse, AppResponse, AppNextResponse,
        SafeResponse, SafeNextResponse, AppSafeResponse, AppSafeNextResponse]) {
        assert.equal(response instanceof Constructor, false);
      }
    }
    assert.equal(json.status, 400);
    assert.deepEqual(await json.json(), {error: "invalid format"});
    assert.equal(redirect.status, 307);
    assert.equal(redirect.headers.get("location"), "https://example.test/export");
    assert.equal(error.status, 0);
    assert.equal(error.type, "error");
    assert.throws(() => error.headers.set("x-test", "value"), TypeError);
    for (const value of [null, undefined, {}, 1, "Response"]) {
      assert.equal(value instanceof Response, false);
      assert.equal(value instanceof NextResponse, false);
    }

    for (const Constructor of [NextResponse, AppResponse, AppNextResponse]) {
      const response = new Constructor("ok");
      assert.ok(response instanceof Constructor);
      assert.ok(response instanceof Response);
      assert.throws(() => new Constructor("<unsafe>", {
        headers: {"content-type": "text/html"},
      }), /raw string response/i);
    }
    for (const Constructor of [SafeResponse, SafeNextResponse, AppSafeResponse, AppSafeNextResponse]) {
      const response = new Constructor(htmlEscape("<safe>"));
      assert.ok(response instanceof Constructor);
      assert.ok(response instanceof Response);
      assert.equal(await response.text(), "&lt;safe&gt;");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.throws(() => new Constructor("<unsafe>"), TypeError);
    }
    const next = NextResponse.json({ok: true});
    assert.ok(next instanceof Response);
    assert.ok(next instanceof NextResponse);
    assert.equal(next instanceof AppNextResponse, false);
    next.cookies.set("session", "value");
    assert.equal(next.cookies.get("session").value, "value");
    assert.deepEqual(await next.json(), {ok: true});
    assert.ok(NextResponse.redirect("https://example.test/") instanceof NextResponse);
  `;
  const {stderr} = await execFileAsync(process.execPath, [
    "--import", "next-xss-sbyd/enforce/preload", "--input-type=module", "--eval", program,
  ], {cwd: new URL("../", import.meta.url), timeout: 30_000});
  assert.equal(stderr, "");
});

// Exercise real native/Next factories in a fresh preloaded process, without mocks.
test("preloaded JSON factories enforce passive content types for every payload shape", async () => {
  const program = `
    import assert from "node:assert/strict";
    import {NextResponse} from "next/server.js";

    const payload = "<script>globalThis.__JSON_XSS__ = true</script>";
    for (const Factory of [Response, NextResponse]) {
      for (const data of [payload, {value: payload}, [payload], 42, null]) {
        for (const contentType of ["text/html", "Text/HTML; charset=utf-8",
          "application/xhtml+xml", "image/svg+xml", "", "application/json, text/html"]) {
          for (const headers of [{"Content-Type": contentType},
            [["cOnTeNt-TyPe", contentType]], new Headers({"content-type": contentType})]) {
            assert.throws(() => Factory.json(data, {headers}),
              {name: "TypeError", message: /JSON response requires an allowlisted passive Content-Type/});
          }
        }
        for (const contentType of ["application/json", "application/problem+json",
          "Application/JSON; charset=utf-8", "text/plain", "application/octet-stream"]) {
          const response = Factory.json(data, {
            status: 400, headers: {"content-type": contentType, "x-test": "preserved"},
          });
          assert.ok(response instanceof Response);
          assert.equal(response instanceof NextResponse, Factory === NextResponse);
          assert.equal(response.status, 400);
          assert.equal(response.headers.get("content-type"), contentType);
          assert.equal(response.headers.get("x-test"), "preserved");
          assert.equal(await response.text(), JSON.stringify(data));
        }
      }
      for (const init of [undefined, {}, {headers: {}}]) {
        const response = Factory.json({value: payload}, init);
        assert.equal(response.headers.get("content-type"), "application/json");
        assert.deepEqual(await response.json(), {value: payload});
      }
      assert.throws(() => Factory.json(undefined), TypeError);
      assert.throws(() => Factory.json(1n), TypeError);
      assert.throws(() => Factory.json({}, {status: 204}), TypeError);
    }
  `;
  const {stderr} = await execFileAsync(process.execPath, [
    "--import", "next-xss-sbyd/enforce/preload", "--input-type=module", "--eval", program,
  ], {cwd: new URL("../", import.meta.url), timeout: 30_000});
  assert.equal(stderr, "");
});
