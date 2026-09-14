import assert from "node:assert/strict";
import {createServer} from "node:http";
import {once} from "node:events";
import {gzipSync} from "node:zlib";
import test from "node:test";
import {htmlEscape, SafeResponse} from "next-xss-sbyd";
import * as enforcement from "next-xss-sbyd/enforce";

const payload = '<script>window.xssProof="executed"</script>';

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("upstream response boundary rejects active and ambiguous types over real HTTP", async () => {
  const upstream = createServer((request, response) => {
    const media = new URL(request.url, "http://localhost").searchParams.get("type");
    if (media) response.setHeader("content-type", media);
    response.setHeader("x-upstream", "retained");
    response.setHeader("x-content-type-options", "off");
    if (request.url.startsWith("/empty")) {
      response.writeHead(Number(new URL(request.url, "http://localhost").searchParams.get("status")));
      response.end();
    } else if (request.url.startsWith("/gzip")) {
      const bytes = gzipSync(payload);
      response.setHeader("content-encoding", "gzip");
      response.setHeader("content-length", bytes.length);
      response.writeHead(202, "Accepted");
      response.end(bytes);
    } else {
      response.writeHead(202, "Accepted");
      response.end(payload);
    }
  });
  const source = await listen(upstream);
  const proxy = createServer(async (request, response) => {
    try {
      const incoming = await fetch(source + request.url);
      const outgoing = request.url.startsWith("/escaped")
        ? new SafeResponse(htmlEscape(await incoming.text()))
        : enforcement.passiveResponse(incoming);
      response.writeHead(outgoing.status, outgoing.statusText, Object.fromEntries(outgoing.headers));
      response.end(Buffer.from(await outgoing.arrayBuffer()));
    } catch (error) {
      response.writeHead(502, {"content-type": "text/plain"});
      response.end(error.message);
    }
  });
  const target = await listen(proxy);
  try {
    // Native fetch bypasses the constructor guard: the explicit return boundary is needed.
    enforcement.installResponseGuard();
    const native = await fetch(source + "/?type=text/html");
    assert.throws(() => native.headers.set("x-check", "immutable"), /immutable/);
    assert.equal(await native.text(), payload);
    for (const media of ["text/plain", "image/png", "application/json", "application/octet-stream", "application/problem+json", 'Application/JSON; charset="utf-8"']) {
      const response = await fetch(target + "/?type=" + encodeURIComponent(media));
      assert.equal(response.status, 202, media);
      assert.equal(response.statusText, "");
      assert.equal(response.headers.get("content-type"), media);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(response.headers.get("x-upstream"), null);
      assert.equal(await response.text(), payload);
    }
    for (const media of ["text/html", "application/xhtml+xml", "image/svg+xml", "application/xml", "application/javascript", "application/pdf", "invalid", "text/plain, text/html", "text/plain; charset", ""]) {
      const response = await fetch(target + "/?type=" + encodeURIComponent(media));
      assert.equal(response.status, 502, media);
      assert.match(await response.text(), /allowlisted passive Content-Type/);
    }
    const escaped = await fetch(target + "/escaped?type=text/html");
    assert.equal(escaped.status, 200);
    assert.equal(escaped.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(escaped.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await escaped.text(), '&lt;script&gt;window.xssProof=&quot;executed&quot;&lt;/script&gt;');
    for (const status of [204]) {
      const response = await fetch(target + `/empty?status=${status}&type=text/plain`);
      assert.equal(response.status, status);
      assert.equal(await response.text(), "");
      const missingType = await fetch(target + `/empty?status=${status}`);
      assert.equal(missingType.status, 502);
      await missingType.text();
    }
    const compressed = await fetch(target + "/gzip?type=text/plain");
    assert.equal(compressed.headers.get("content-encoding"), null);
    assert.equal(await compressed.text(), payload);
  } finally {
    await close(proxy);
    await close(upstream);
  }
});


test("passiveResponse forwards only passive metadata from an actual upstream", async () => {
  const retained = {
    "content-type": "text/plain", "content-disposition": "attachment; filename=data.txt",
    "cache-control": "private", etag: '"v1"', "last-modified": "Wed, 01 Jan 2025 00:00:00 GMT",
    vary: "accept", expires: "Wed, 01 Jan 2025 00:00:00 GMT", "content-language": "en",
    "accept-ranges": "bytes", "content-range": "bytes 0-3/4",
  };
  const dropped = {
    "set-cookie": ["session=attacker; Path=/", "csrf=forged; Path=/"],
    "access-control-allow-origin": "https://evil.example", "access-control-allow-credentials": "true",
    refresh: "0; url=https://evil.example", location: "https://evil.example",
    "content-security-policy": "default-src *", "content-security-policy-report-only": "default-src *",
    connection: "keep-alive", "keep-alive": "timeout=5", "transfer-encoding": "chunked", "x-upstream": "secret",
  };
  const server = createServer(function serve(request, response) {
    for (const [name, value] of Object.entries(retained)) response.setHeader(name, value);
    for (const [name, value] of Object.entries(dropped)) response.setHeader(name, value);
    if (request.url === "/length") {
      response.removeHeader("transfer-encoding");
      response.setHeader("content-length", "4");
    }
    response.writeHead(request.url === "/error" ? 400 : 200, "Untrusted reason");
    response.end("data");
  });
  const origin = await listen(server);
  try {
    for (const path of ["/chunked", "/length", "/error"]) {
      const result = enforcement.passiveResponse(await fetch(origin + path));
      const expected = {...retained, "x-content-type-options": "nosniff"};
      if (path === "/length") expected["content-length"] = "4";
      assert.deepEqual(Object.fromEntries(result.headers), expected);
      assert.equal(result.status, path === "/error" ? 400 : 200);
      assert.equal(result.statusText, "");
      assert.equal(await result.text(), "data");
    }
  } finally { await close(server); }
});

test("passiveResponse rejects upstream 3xx responses before forwarding navigation", async () => {
  const server = createServer(function serve(request, response) {
    response.writeHead(Number(request.url.slice(1)), {"content-type": "text/plain", location: "https://evil.example"});
    response.end();
  });
  const origin = await listen(server);
  try {
    for (const status of [300, 301, 302, 303, 304, 307, 308, 399]) {
      const incoming = await fetch(origin + "/" + status, {redirect: "manual"});
      assert.throws(() => enforcement.passiveResponse(incoming), /3xx/u);
      await incoming.arrayBuffer();
    }
  } finally { await close(server); }
});
