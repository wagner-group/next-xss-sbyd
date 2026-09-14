import assert from "node:assert/strict";
import {createServer} from "node:http";
import test from "node:test";

import {createElement, Suspense, use} from "react";
import {trustedResourceUrl} from "safevalues";
import {SafeResponse, safePipe} from "next-xss-sbyd";
import {
  safeRenderToPipeableStream,
  safeRenderToReadableStream,
  safeRenderToString,
} from "next-xss-sbyd/render";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("safeRenderToString relies on React escaping and returns sink-compatible SafeHtml", async () => {
  const html = safeRenderToString(createElement("main", null, '<script>globalThis.__XSS__=true</script>'));
  const response = new SafeResponse(html);
  assert.equal(await response.text(), '<main>&lt;script&gt;globalThis.__XSS__=true&lt;/script&gt;</main>');
});

test("Web rendering remains opaque and preserves allReady and trusted bootstrap scripts", async () => {
  const stream = await safeRenderToReadableStream(
    createElement("html", null, createElement("body", null, "streamed <safe>")),
    {bootstrapScripts: [trustedResourceUrl`/client.js`]},
  );
  await stream.allReady;
  const response = new SafeResponse(stream);
  const body = await response.text();
  assert.match(body, /streamed &lt;safe&gt;/);
  assert.match(body, /<script src="\/client.js"[^>]*async=""><\/script>/);
  assert.throws(() => new SafeResponse({allReady: Promise.resolve()}), /unwrap SafeHtml/);
});

test("stream renderers discard forbidden options supplied at runtime", async () => {
  const forbidden = {
    bootstrapScriptContent: "globalThis.__XSS__ = true;",
    importMap: {imports: {unsafe: "javascript:alert(1)"}},
    namespaceURI: "http://www.w3.org/2000/svg",
  };
  const readable = await safeRenderToReadableStream(
    createElement("html", null, createElement("body", null, "web")),
    forbidden,
  );
  await readable.allReady;
  const webBody = await new SafeResponse(readable).text();
  assert.doesNotMatch(webBody, /__XSS__|importmap|<svg/);

  const server = createServer((_request, response) => {
    safePipe(response, safeRenderToPipeableStream(
      createElement("html", null, createElement("body", null, "node")),
      forbidden,
    ));
  });
  const port = await listen(server);
  try {
    const nodeBody = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    assert.doesNotMatch(nodeBody, /__XSS__|importmap|<svg/);
  } finally {
    await close(server);
  }
});

test("Node rendering streams through a real HTTP response with fixed headers", async () => {
  const errors = [];
  const server = createServer((request, response) => {
    const stream = safeRenderToPipeableStream(
      createElement("html", null, createElement("body", null, `path=${request.url} <safe>`)),
    );
    safePipe(response, stream, {status: 201, headers: {"x-test": "yes"}, onError: (error) => errors.push(error)});
  });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/node`);
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-test"), "yes");
    assert.match(await response.text(), /path=\/node &lt;safe&gt;/);
    assert.deepEqual(errors, []);
  } finally {
    await close(server);
  }
});

test("Node rendering sends a fixed plain-text 500 when the shell cannot render", async () => {
  function Broken() { throw new Error("secret rendering detail"); }
  const observed = [];
  const server = createServer((_request, response) => {
    safePipe(response, safeRenderToPipeableStream(createElement(Broken)), {onError: (error) => observed.push(error)});
  });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await response.text(), "Internal Server Error");
    assert.equal(observed.length >= 1, true);
  } finally {
    await close(server);
  }
});

test("Node rendering aborts a response when asynchronous content fails after shell flush", async () => {
  const observed = [];
  let closed = 0;
  let finished = 0;
  const server = createServer((_request, response) => {
    let rejectContent;
    const content = new Promise((_resolve, reject) => { rejectContent = reject; });
    function DeferredFailure() { use(content); return createElement("p", null, "done"); }
    response.on("close", () => { closed += 1; });
    response.on("finish", () => { finished += 1; });
    safePipe(response, safeRenderToPipeableStream(
      createElement("html", null, createElement("body", null,
        createElement("p", null, "shell"),
        createElement(Suspense, {fallback: createElement("p", null, "waiting")}, createElement(DeferredFailure)),
      )),
    ), {onError: (error) => observed.push(error)});
    const delay = Number(new URL(_request.url, "http://localhost").searchParams.get("delay"));
    setTimeout(() => rejectContent(new Error("late failure")), delay);
  });
  const port = await listen(server);
  try {
    for (const delay of [0, 1, 2, 5, 10, 20]) {
      const response = await fetch(`http://127.0.0.1:${port}/?delay=${delay}`);
      await response.text().catch(() => undefined);
    }
    assert.equal(observed.filter((error) => error instanceof Error && error.message === "late failure").length, 6);
    assert.equal(closed, 6);
    assert.equal(finished, 0, "a failed stream must never finish as a successful response");
  } finally {
    server.closeAllConnections();
    await close(server);
  }
});

test("safePipe rejects forged and reused Node stream wrappers and security header overrides", async () => {
  const server = createServer((_request, response) => response.end());
  const port = await listen(server);
  try {
    const response = {allReady: Promise.resolve()};
    assert.throws(() => safePipe(server, response), /Invalid SafeNodeStream/);
    const stream = safeRenderToPipeableStream(createElement("div", null, "once"));
    assert.throws(() => safePipe(server, stream, {headers: {"content-type": "text/plain"}}), /cannot be overridden/);
  } finally {
    await close(server);
  }
});
