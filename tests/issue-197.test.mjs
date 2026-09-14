import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import test from "node:test";
import {promisify} from "node:util";

const execFileAsync = promisify(execFile);

for (const mode of ["preload", "instrumentation"]) {
  test(`${mode}: NextResponse constructor coverage follows installation order`, async () => {
    // A real, fresh process fixes the import order without replacing any APIs.
    // Production bundling can load NextResponse later; this deliberately exercises
    // the documented limitation when Next captured Response before register().
    const program = `
      import assert from "node:assert/strict";
      import {NextResponse} from "next/server.js";
      import {installResponseGuard, isGuardInstalled} from "next-xss-sbyd/enforce";
      import {htmlEscape, SafeResponse, SafeNextResponse} from "next-xss-sbyd";

      const preloaded = ${mode === "preload"};
      assert.equal(isGuardInstalled(), preloaded);
      const superclass = Object.getPrototypeOf(NextResponse);
      if (!preloaded) installResponseGuard();
      assert.equal(isGuardInstalled(), true);
      assert.equal(Object.getPrototypeOf(NextResponse), superclass);
      assert.equal(superclass === Response, preloaded);

      const init = {headers: {"content-type": "text/html"}};
      assert.throws(() => new Response("<unsafe>", init), /Raw string response/);
      if (preloaded) {
        assert.throws(() => new NextResponse("<unsafe>", init), /Raw string response/);
      } else {
        const unguarded = new NextResponse("<unsafe>", init);
        assert.equal(await unguarded.text(), "<unsafe>");
        assert.ok(unguarded instanceof Response);
        assert.ok(unguarded instanceof NextResponse);
      }

      for (const Factory of [Response, NextResponse]) {
        const json = Factory.json({error: "invalid format"}, {status: 400});
        assert.equal(json.status, 400);
        assert.deepEqual(await json.json(), {error: "invalid format"});
        assert.ok(json instanceof Response);
        assert.equal(json instanceof NextResponse, Factory === NextResponse);
        assert.throws(() => Factory.json({value: "<unsafe>"}, init), /JSON response/);
        const redirect = Factory.redirect("https://example.test/export", 307);
        assert.equal(redirect.status, 307);
        assert.equal(redirect.headers.get("location"), "https://example.test/export");
      }
      const error = Response.error();
      assert.ok(error instanceof Response);
      assert.equal(error instanceof NextResponse, false);
      assert.equal(error.status, 0);
      assert.equal(error.type, "error");
      for (const Constructor of [SafeResponse, SafeNextResponse]) {
        const safe = new Constructor(htmlEscape("<safe>"));
        assert.equal(await safe.text(), "&lt;safe&gt;");
        assert.equal(safe.headers.get("content-type"), "text/html; charset=utf-8");
        assert.equal(safe.headers.get("x-content-type-options"), "nosniff");
      }
    `;
    const args = ["--input-type=module", "--eval", program];
    if (mode === "preload") args.unshift("--import", "next-xss-sbyd/enforce/preload");
    const {stderr} = await execFileAsync(process.execPath, args, {
      cwd: new URL("../", import.meta.url),
      env: {...process.env, NODE_OPTIONS: ""},
      timeout: 30_000,
    });
    assert.equal(stderr, "");
  });
}
