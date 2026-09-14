import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {cp, mkdir, mkdtemp, rm} from "node:fs/promises";
import test from "node:test";
import {promisify} from "node:util";

const execFileAsync = promisify(execFile);
const root = new URL("../", import.meta.url);
// Boot self-test failure branches require replacing the native constructor or
// changing the guard implementation. These integration tests use real constructors.
const imports = `
  import assert from "node:assert/strict";
  import {NextResponse} from "next/server.js";
  import {htmlEscape, SafeNextResponse, SafeResponse} from "next-xss-sbyd";
  import {safeRenderToReadableStream} from "next-xss-sbyd/render";
  const raw = "<script>alert(1)</script>";
  const htmlInit = {headers: {"content-type": "text/html"}};
`;

async function run(program, preload = true) {
  const args = preload ? ["--import", "next-xss-sbyd/enforce/preload"] : [];
  const {stderr} = await execFileAsync(process.execPath, [
    ...args, "--input-type=module", "--eval", program,
  ], {cwd: root, timeout: 30_000});
  assert.equal(stderr, "");
}

for (const attack of ["global-name", "copied", "global-copied", "inherited", "reflected"]) {
  test(`constructor marker cannot bypass authentication: ${attack}`, async () => {
    await run(imports + `
      const marker = Object.getOwnPropertySymbols(SafeResponse).find(
        (symbol) => symbol.description === "next-xss-sbyd.response.safe-constructor.v1",
      );
      assert.ok(marker);
      let constructors;
      if (${JSON.stringify(attack)} === "global-name") {
        Object.defineProperty(Response, Symbol.for("next-xss-sbyd.response.safe-constructor"), {value: true});
        constructors = [Response, NextResponse];
      } else if (${JSON.stringify(attack)} === "copied") {
        class CopiedResponse extends Response {}
        class CopiedNextResponse extends NextResponse {}
        for (const Class of [CopiedResponse, CopiedNextResponse]) {
          Object.defineProperty(Class, marker, {value: true});
        }
        constructors = [CopiedResponse, CopiedNextResponse];
      } else if (${JSON.stringify(attack)} === "global-copied") {
        Object.defineProperty(Response, marker, {value: true});
        constructors = [Response, NextResponse];
      } else {
        class InheritedResponse extends SafeResponse {}
        class InheritedNextResponse extends SafeNextResponse {}
        constructors = ${JSON.stringify(attack)} === "inherited"
          ? [InheritedResponse, InheritedNextResponse] : [SafeResponse, SafeNextResponse];
      }
      for (const Class of constructors) {
        // Reflect.construct skips Class's constructor, even for a trusted new.target.
        assert.throws(() => Reflect.construct(Response, [raw, htmlInit], Class), TypeError);
        assert.throws(() => Reflect.construct(NextResponse, [raw, htmlInit], Class), TypeError);
        if (${JSON.stringify(attack)} !== "global-name") {
          for (const body of [raw, null, undefined, {},
            {privateDoNotAccessOrElseWrappedHtml: raw},
            Object.create(Object.getPrototypeOf(await safeRenderToReadableStream("safe")))]) {
            assert.throws(() => Reflect.construct(Response, [body], Class), TypeError);
            assert.throws(() => Reflect.construct(NextResponse, [body, {headers: {"content-type": "text/plain"}}], Class), TypeError);
          }
          const safe = Reflect.construct(Response, [htmlEscape(raw)], Class);
          assert.equal(await safe.text(), "&lt;script&gt;alert(1)&lt;/script&gt;");
          assert.equal(safe.headers.get("content-type"), "text/html; charset=utf-8");
          assert.equal(safe.headers.get("x-content-type-options"), "nosniff");
          assert.throws(() => Reflect.construct(Response, [htmlEscape("ok"), htmlInit], Class), /security header/);
        }
      }
    `);
  });
}

for (const order of ["preload", "none", "late", "next-first", "enforce-first"]) {
  test(`safe response protocol preserves HTML, streams, headers and cookies: ${order}`, async () => {
    const setup = {
      preload: "",
      none: "",
      late: 'await import("next-xss-sbyd"); (await import("next-xss-sbyd/enforce")).installResponseGuard();',
      "next-first": 'await import("next/server.js"); (await import("next-xss-sbyd/enforce")).installResponseGuard();',
      "enforce-first": '(await import("next-xss-sbyd/enforce")).installResponseGuard();',
    }[order];
    // Dynamic imports are essential: static imports would erase the startup ordering.
    await run(setup + `
      const assert = (await import("node:assert/strict")).default;
      const {SafeResponse, SafeNextResponse, htmlEscape} = await import("next-xss-sbyd");
      const {safeRenderToReadableStream} = await import("next-xss-sbyd/render");
      const awaitedStream = await safeRenderToReadableStream("safe");
      class DerivedResponse extends SafeResponse {}
      class DerivedNextResponse extends SafeNextResponse {}
      for (const Class of [SafeResponse, SafeNextResponse, DerivedResponse, DerivedNextResponse]) {
        for (const body of [htmlEscape("<safe>"), await safeRenderToReadableStream("<safe>")]) {
          const headers = new Headers({"x-test": "preserved"});
          const response = new Class(body, {status: 201, statusText: "Created", headers});
          assert.equal(await response.text(), "&lt;safe&gt;");
          assert.equal(response.status, 201);
          assert.equal(response.statusText, "Created");
          assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
          assert.equal(response.headers.get("x-content-type-options"), "nosniff");
          assert.equal(response.headers.get("x-test"), "preserved");
          assert.equal(headers.has("content-type"), false);
          if (response.cookies) {
            response.cookies.set("session", "value", {httpOnly: true});
            assert.equal(response.cookies.get("session").value, "value");
            assert.match(response.headers.get("set-cookie"), /HttpOnly/);
          }
        }
        for (const headers of [{"Content-Type": "text/plain"},
          [["CONTENT-type", "text/html"]], new Headers({"X-Content-Type-Options": "nosniff"})]) {
          assert.throws(() => new Class(htmlEscape("safe"), {headers}), /security header/);
          assert.throws(() => new Class(awaitedStream, {headers}), /security header/);
        }
        assert.throws(() => new Class("raw"), TypeError);
        assert.throws(() => new Class({privateDoNotAccessOrElseWrappedHtml: "raw"}), TypeError);
      }
    `, order === "preload");
  });
}

test("marked calls reject primitive and empty bodies before consulting the registry", async () => {
  await run(imports + `
    // Deliberate registry mutation is outside the threat model, but even this
    // registration must not turn a raw string into a valid protocol input.
    const registry = globalThis[Symbol.for("next-xss-sbyd.enforce.authenticators")];
    registry.unshift(() => ({body: raw, kind: "html"}));
    for (const body of [raw, null, undefined, 1, true, Symbol("raw")]) {
      assert.throws(() => Reflect.construct(Response, [body], SafeResponse), TypeError);
      assert.throws(() => Reflect.construct(NextResponse, [body], SafeNextResponse), TypeError);
    }
  `);
});

test("registered package copies cooperate while unregistered body brands fail closed", async () => {
  const scratch = new URL("tmp/", root);
  await mkdir(scratch, {recursive: true});
  const directory = await mkdtemp(new URL("response-copies-", scratch).pathname);
  try {
    await cp(new URL("packages/next-xss-sbyd/dist/", root), `${directory}/dist`, {recursive: true});
    await cp(new URL("node_modules/safevalues/", root), `${directory}/node_modules/safevalues`, {recursive: true});
    await cp(new URL("node_modules/safevalues/", root), `${directory}/foreign-safevalues`, {recursive: true});
    const copies = `
      const copy = await import(${JSON.stringify(`${directory}/dist/response.js`)});
      const render = await import(${JSON.stringify(`${directory}/dist/render.js`)});
      const copyValues = await import(${JSON.stringify(`${directory}/node_modules/safevalues/dist/mjs/index.js`)});
      const foreign = await import(${JSON.stringify(`${directory}/foreign-safevalues/dist/mjs/index.js`)});
    `;
    await run(imports + copies + `
      // Importing response APIs registers their brands, without importing /enforce.
      const implementations = [
        [SafeResponse, htmlEscape, safeRenderToReadableStream],
        [SafeNextResponse, htmlEscape, safeRenderToReadableStream],
        [copy.SafeResponse, copyValues.htmlEscape, render.safeRenderToReadableStream],
        [copy.SafeNextResponse, copyValues.htmlEscape, render.safeRenderToReadableStream],
      ];
      for (const [Class, escape, renderStream] of implementations) {
        for (const body of [escape("<safe>"), await renderStream("<safe>")]) {
          const response = new Class(body);
          assert.equal(await response.text(), "&lt;safe&gt;");
          assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
          assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        }
        assert.throws(() => new Class(foreign.htmlEscape("foreign")), TypeError);
        assert.throws(() => new Class(raw), TypeError);
        assert.throws(() => Reflect.construct(Response, [raw, htmlInit], Class), TypeError);
        assert.throws(() => new Class(escape("safe"), htmlInit), /security header/);
      }
      // The installed guard must authenticate the foreign brands itself, including
      // when reflection skips the foreign safe constructor's local validation.
      for (const body of [copyValues.htmlEscape("<safe>"), await render.safeRenderToReadableStream("<safe>")]) {
        const response = Reflect.construct(Response, [body], copy.SafeResponse);
        assert.equal(await response.text(), "&lt;safe&gt;");
        assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      }
      assert.throws(() => Reflect.construct(Response, [foreign.htmlEscape("foreign")], copy.SafeResponse), TypeError);
      assert.throws(() => new SafeResponse(copyValues.htmlEscape("foreign")), /deduplicate safevalues/);
      assert.throws(() => new copy.SafeResponse(htmlEscape("foreign")), /deduplicate safevalues/);
      for (const Class of [Response, NextResponse]) {
        assert.throws(() => new Class(copyValues.htmlEscape("safe")), /SafeResponse/);
        assert.throws(() => new Class(foreign.htmlEscape("foreign")), /SafeResponse/);
        const stream = await render.safeRenderToReadableStream("safe");
        assert.throws(() => new Class(stream), /SafeResponse/);
      }
    `);
    await run(imports + copies + `
      // Without a guarded parent, each constructor authenticates locally.
      for (const Class of [SafeResponse, SafeNextResponse]) {
        assert.throws(() => new Class(copyValues.htmlEscape("foreign")), /deduplicate safevalues/);
        const stream = await render.safeRenderToReadableStream("foreign");
        assert.throws(() => new Class(stream), TypeError);
      }
      for (const Class of [copy.SafeResponse, copy.SafeNextResponse]) {
        assert.equal(await new Class(copyValues.htmlEscape("own")).text(), "own");
        assert.throws(() => new Class(htmlEscape("foreign")), /deduplicate safevalues/);
      }
    `, false);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("a forged guarded-parent marker cannot skip safe-constructor validation", async () => {
  await run(imports + `
    Object.defineProperty(Response, Symbol.for("next-xss-sbyd.enforce.class.v1"), {value: true});
    for (const Class of [SafeResponse, SafeNextResponse]) {
      assert.throws(() => new Class(raw, htmlInit), TypeError);
      assert.throws(() => new Class({toString() { return raw; }}), TypeError);
      const counterfeitStream = Object.create(Object.getPrototypeOf(await safeRenderToReadableStream("safe")));
      assert.throws(() => new Class(counterfeitStream), TypeError);
      for (const headers of [{"content-type": "text/html"}, {"x-content-type-options": "off"}]) {
        assert.throws(() => new Class(htmlEscape("safe"), {headers}), /security header/);
      }
    }
  `, false);
});
