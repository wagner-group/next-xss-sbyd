import assert from "node:assert/strict";
import {fork} from "node:child_process";
import {once} from "node:events";
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import test from "node:test";
import {setTimeout as delay} from "node:timers/promises";

test("CSP middleware composition through a real Next HTTP server", {timeout: 120_000}, async (t) => {
  const temporaryRoot = new URL("../tmp/", import.meta.url);
  await mkdir(temporaryRoot, {recursive: true});
  const root = await mkdtemp(new URL("middleware-integration-", temporaryRoot));
  await mkdir(join(root, "pages/api"), {recursive: true});
  await writeFile(join(root, "package.json"), JSON.stringify({private: true, type: "module"}));
  await writeFile(join(root, "pages/api/[mode].js"), `
export default function handler(request, response) {
  response.json({
    user: request.headers["x-user"] ?? null,
    authorization: request.headers.authorization ?? null,
    marker: request.headers["x-inner-marker"] ?? null,
    nonce: request.headers["x-nonce"] ?? null,
  });
}
`);
  await writeFile(join(root, "middleware.js"), `
import {NextResponse} from "next/server";
import {withXssSbydHeaders} from "next-xss-sbyd/csp";
function stripUntrustedIdentity(request) {
  const headers = new Headers(request.headers);
  headers.delete("x-user");
  headers.delete("authorization");
  headers.set("x-inner-marker", "checked");
  return NextResponse.next({request: {headers}});
}
const wrapped = withXssSbydHeaders(stripUntrustedIdentity);
const reporting = withXssSbydHeaders(stripUntrustedIdentity, {reportTo: "/csp-report"});
const externalReporting = withXssSbydHeaders(stripUntrustedIdentity, {
  reportTo: ${JSON.stringify("/\\evil.example/report")},
});
export default function middleware(request, event) {
  if (request.nextUrl.pathname === "/api/reporting") return reporting(request, event);
  if (request.nextUrl.pathname === "/api/external-reporting") return externalReporting(request, event);
  return request.nextUrl.pathname === "/api/control"
    ? stripUntrustedIdentity(request)
    : wrapped(request, event);
}
export const config = {matcher: "/api/:path*"};
`);
  await writeFile(join(root, "server.mjs"), `
import next from "next";
import {createServer} from "node:http";
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const app = next({dev: true, dir: process.cwd(), hostname: "127.0.0.1", port});
await app.prepare();
server.on("request", app.getRequestHandler());
process.send({port});
`);
  const child = fork(join(root, "server.mjs"), {
    cwd: root,
    silent: true,
    env: {...process.env, NEXT_TELEMETRY_DISABLED: "1"},
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      try { await exited; } finally { clearTimeout(timer); }
    }
    await rm(root, {recursive: true, force: true});
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Next startup timed out:\n${output}`)), 60_000);
    child.once("message", (message) => { clearTimeout(timer); resolve(message.port); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Next exited (${code}):\n${output}`));
    });
  });
  // Next's first watcher event can discover middleware before nested API routes.
  // Wait for an actual route response before checking middleware behavior.
  const readinessDeadline = Date.now() + 45_000;
  while (true) {
    const response = await fetch(`http://127.0.0.1:${port}/api/control`, {
      signal: AbortSignal.timeout(45_000),
    });
    await response.arrayBuffer();
    if (response.status === 200) break;
    assert.equal(response.status, 404, output);
    assert.ok(Date.now() < readinessDeadline, `Next API route did not become ready:\n${output}`);
    await delay(50);
  }
  async function request(mode) {
    const response = await fetch(`http://127.0.0.1:${port}/api/${mode}`, {
      headers: {"x-user": "attacker-admin", authorization: "Bearer attacker-token"},
      signal: AbortSignal.timeout(45_000),
    });
    assert.equal(response.status, 200, output);
    return {response, body: await response.json()};
  }
  await t.test("Next alone removes client-supplied identity headers", async () => {
    const {body} = await request("control");
    assert.deepEqual(body, {user: null, authorization: null, marker: "checked", nonce: null});
  });
  await t.test("wrapper preserves inner additions and supplies a matching CSP nonce", async () => {
    const {body, response} = await request("wrapped");
    assert.equal(body.marker, "checked");
    assert.match(body.nonce, /^[A-Za-z0-9_-]{22}$/);
    assert.ok(response.headers.get("content-security-policy").includes(`'nonce-${body.nonce}'`));
  });
  await t.test("wrapper preserves inner deletion of client-supplied identity headers", async () => {
    const {body} = await request("wrapped");
    assert.deepEqual({user: body.user, authorization: body.authorization}, {user: null, authorization: null});
  });
  await t.test("root-relative reporting endpoints remain on the request origin", async () => {
    const {response} = await request("reporting");
    // Next normalizes loopback request URLs to localhost in development.
    assert.equal(response.headers.get("reporting-endpoints"), `xss-sbyd="http://localhost:${port}/csp-report"`);
  });
  await t.test("reporting endpoint validation rejects a backslash authority escape", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/external-reporting`, {
      signal: AbortSignal.timeout(45_000),
    });
    assert.equal(response.status, 500, `Invalid endpoint was accepted: ${response.headers.get("reporting-endpoints")}`);
    assert.equal(response.headers.has("reporting-endpoints"), false);
    assert.match(await response.text(), /Invalid CSP Reporting API endpoint/);
  });
});
