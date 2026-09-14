import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PASSIVE_MEDIA_TYPES} from "next-xss-sbyd/passive-content";
import {once} from "node:events";
import {createServer} from "node:http";
import {Readable} from "node:stream";
import test from "node:test";
import {installResponseGuard, passiveResponse, withSafeApiRoute, withSafeRouteHandler} from "next-xss-sbyd/enforce";
import {passiveTypes, rejectedTypes} from "./passive-content-cases.mjs";

const payload = '<!doctype html><script>globalThis.__passiveXss = true</script>';

/** Sends actual HTTP bodies through each enforcement entry point. */
test("passive media types work across Response, JSON, proxy and Node string/byte/stream output", async () => {
  assert.equal(Object.isFrozen(PASSIVE_MEDIA_TYPES), true);
  assert.deepEqual([...PASSIVE_MEDIA_TYPES].sort(), passiveTypes.filter(type => type !== "application/problem+json").sort());
  const documentation = await readFile(new URL("../docs/passive-content.md", import.meta.url), "utf8");
  const documented = [...documentation.split("\n").filter(line => line.startsWith("| ")).join("\n").matchAll(/`([^`]+)`/gu)].map(match => match[1]).filter(type => type.includes("/") && type !== "application/*+json");
  assert.deepEqual(documented.sort(), [...PASSIVE_MEDIA_TYPES].sort());
  installResponseGuard();
  let origin;
  const guarded = withSafeApiRoute(function serve(request, response) {
    const url = new URL(request.url, origin);
    const type = url.searchParams.get("type");
    if (type) response.setHeader("content-type", type);
    if (url.pathname === "/bytes") response.end(Buffer.from(payload));
    else if (url.pathname === "/stream") Readable.from([Buffer.from(payload)]).pipe(response);
    else response.end(payload);
  });
  const server = createServer(async function serve(request, response) {
    const url = new URL(request.url, origin);
    const type = url.searchParams.get("type");
    try {
      if (url.pathname === "/upstream") {
        if (type) response.setHeader("content-type", type);
        response.end(payload);
      } else if (["/response", "/json", "/proxy", "/route"].includes(url.pathname)) {
        const headers = type ? {"content-type": type} : {};
        const result = url.pathname === "/route" ? await withSafeRouteHandler(() => new Response(new TextEncoder().encode(payload), {headers}))()
          : url.pathname === "/proxy" ? passiveResponse(await fetch(origin + "/upstream" + url.search))
          : url.pathname === "/json" ? Response.json(payload, {headers}) : new Response(payload, {headers});
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
      } else guarded(request, response);
    } catch (error) {
      response.writeHead(422, {"content-type": "text/plain"});
      response.end(error.message);
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const type of [...passiveTypes, ...passiveTypes.map(type => `${type}; charset=utf-8`), 'IMAGE/PNG; profile="test;case"', "APPLICATION/PROBLEM+JSON; charset=utf-8"]) {
      for (const mode of ["response", "json", "proxy", "route", "string", "bytes", "stream"]) {
        const result = await fetch(`${origin}/${mode}?type=${encodeURIComponent(type)}`);
        assert.equal(result.status, 200, `${mode}: ${type}`);
        assert.equal(result.headers.get("content-type"), type);
        if (mode === "proxy" || mode === "route") assert.equal(result.headers.get("x-content-type-options"), "nosniff");
        assert.equal(await result.text(), mode === "json" ? JSON.stringify(payload) : payload);
      }
    }
    for (const type of rejectedTypes) {
      // Rejected asynchronous stream chunks intentionally destroy sockets; the
      // existing stream integration tests cover that behavior. Check synchronous
      // string and byte writes here so failures produce a deterministic HTTP error.
      for (const mode of ["response", "json", "proxy", "route", "string", "bytes"]) {
        if (!type && ["response", "json"].includes(mode)) continue; // Native default is plain text / JSON.
        const result = await fetch(`${origin}/${mode}?type=${encodeURIComponent(type)}`);
        assert.equal(result.status, 422, `${mode}: ${type}`);
        assert.match(await result.text(), /allowlisted passive Content-Type/);
      }
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
