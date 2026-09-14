import assert from "node:assert/strict";
import {once} from "node:events";
import {cp, mkdir, mkdtemp, rm} from "node:fs/promises";
import {createServer} from "node:http";
import test from "node:test";
import {apiResolver} from "next/dist/server/api-utils/node/api-resolver.js";
import {htmlEscape, safePipe, SafeResponse} from "next-xss-sbyd";
import {installResponseGuard, withSafeApiRoute} from "next-xss-sbyd/enforce";
import {safeRenderToPipeableStream} from "next-xss-sbyd/render";

const root = new URL("../", import.meta.url);

/** Sends HTML through a real Next Pages response, preserving handler failures. */
async function request(handler) {
  let failure;
  const server = createServer(async function serve(req, res) {
    try {
      await apiResolver(req, res, {}, {default: handler}, {}, true);
    } catch (error) {
      failure = error;
      if (res.headersSent) res.destroy();
      else {
        res.statusCode = 500;
        res.removeHeader("content-type");
        res.end();
      }
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`, {signal: AbortSignal.timeout(10_000)});
    const body = await response.text();
    if (failure) throw failure;
    return {body, headers: response.headers};
  } catch (error) {
    throw failure ?? error;
  } finally {
    server.closeAllConnections();
    const closed = once(server, "close");
    server.close();
    await closed;
  }
}

test("Pages response protocol handles registered physical package copies", async (t) => {
  await mkdir(new URL("tmp/", root), {recursive: true});
  const directory = await mkdtemp(new URL("tmp/pages-response-copies-", root).pathname);
  try {
    await cp(new URL("packages/next-xss-sbyd/dist/", root), `${directory}/dist`, {recursive: true});
    await cp(new URL("node_modules/safevalues/", root), `${directory}/node_modules/safevalues`, {recursive: true});
    const copy = await import(`${directory}/dist/enforce.js`);
    const values = await import(`${directory}/node_modules/safevalues/dist/mjs/index.js`);
    const render = await import(`${directory}/dist/render.js`);
    const responses = await import(`${directory}/dist/response.js`);

    await t.test("registered copies pipe authenticated streams through guarded Pages responses", async () => {
      for (const wrap of [withSafeApiRoute, copy.withSafeApiRoute]) {
        for (const [pipe, renderStream] of [[safePipe, safeRenderToPipeableStream], [responses.safePipe, render.safeRenderToPipeableStream]]) {
          const response = await request(wrap(function handler(_req, res) {
            pipe(res, renderStream("<foreign>"));
          }));
          assert.equal(response.body, "&lt;foreign&gt;");
          assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        }
      }
    });

    await t.test("registered foreign SafeHtml crosses explicit Pages sinks", async () => {
      for (const wrap of [withSafeApiRoute, copy.withSafeApiRoute]) {
        for (const escape of [htmlEscape, values.htmlEscape]) {
          for (const method of ["safeSend", "safeEnd"]) {
            const response = await request(wrap(function handler(_req, res) {
              res[method](escape("<foreign>"));
            }));
            assert.equal(response.body, "&lt;foreign&gt;");
            assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
            assert.equal(response.headers.get("x-content-type-options"), "nosniff");
            assert.equal(response.headers.has("etag"), method === "safeSend");
          }
        }
      }
    });

    await t.test("ordinary methods reject registered foreign HTML and both stream kinds", async () => {
      const bodies = [values.htmlEscape("foreign"), await render.safeRenderToReadableStream("foreign"), render.safeRenderToPipeableStream("foreign")];
      const response = await request(withSafeApiRoute(function handler(_req, res) {
        for (const method of ["send", "end", "write"]) {
          for (const body of bodies) {
            assert.throws(() => res[method](body), /safeSend|safeEnd|safePipe|SafeResponse/);
            assert.equal(res.headersSent, false);
          }
        }
        res.json({rejected: true});
      }));
      assert.deepEqual(JSON.parse(response.body), {rejected: true});
    });

    await t.test("guarded constructor reflection rejects authenticated Node streams", () => {
      installResponseGuard();
      for (const body of [safeRenderToPipeableStream("local"), render.safeRenderToPipeableStream("foreign")]) {
        assert.throws(() => Reflect.construct(Response, [body], SafeResponse), /authenticated SafeHtml or SafeStream/);
      }
    });

    await t.test("wrappers from distinct copies compose around a real Pages handler", async () => {
      for (const [outer, inner] of [[withSafeApiRoute, copy.withSafeApiRoute], [copy.withSafeApiRoute, withSafeApiRoute]]) {
        const response = await request(outer(inner(function handler(_req, res) {
          res.safeSend(htmlEscape("<nested>"));
        })));
        assert.equal(response.body, "&lt;nested&gt;");
      }
    });
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
