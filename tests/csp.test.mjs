import assert from "node:assert/strict";
import test from "node:test";

import {NextRequest, NextResponse} from "next/server.js";
import {
  createContentSecurityPolicy,
  createCspReportHandler,
  createXssSbydHandler,
  reportsToCspOptions,
  withXssSbydHeaders,
} from "next-xss-sbyd/csp";

const validNonce = "abcdefghijklmnopqrstuv";

test("CSP policy is restrictive, configurable, and syntactically injection-safe", () => {
  const policy = createContentSecurityPolicy(validNonce, {
    connectSrc: ["'self'", "https://api.example.test"],
    imgSrc: ["'self'", "data:"],
    reportUri: "/csp-report",
  });
  assert.match(policy, /script-src 'self' 'nonce-abcdefghijklmnopqrstuv' 'strict-dynamic'/);
  assert.match(policy, /style-src-elem 'self' 'nonce-abcdefghijklmnopqrstuv'/);
  assert.match(policy, /connect-src 'self' https:\/\/api\.example\.test/);
  assert.match(policy, /object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'/);
  assert.match(policy, /report-uri \/csp-report$/);
  assert.deepEqual(policy.split("; ").filter(value => value.includes("'unsafe-inline'")), ["style-src 'self' 'unsafe-inline'", "style-src-attr 'unsafe-inline'"]);
  if (process.env.NODE_ENV === "development") assert.match(policy, /unsafe-eval/);
  else assert.doesNotMatch(policy, /unsafe-eval/);

  assert.throws(() => createContentSecurityPolicy("short"), /nonce/);
  assert.throws(() => createContentSecurityPolicy(validNonce, {scriptSrc: ["'self'; img-src *"]}), /script-src/);
  assert.throws(() => createContentSecurityPolicy(validNonce, {reportUri: "//evil.test/report"}), /report URI/);
  assert.throws(() => createContentSecurityPolicy(validNonce, {reportTo: "https://evil.test/report"}), /Reporting API endpoint/);
  assert.throws(() => createContentSecurityPolicy(validNonce, {reportUri: "/\\\\evil.test/report"}), /report URI/);
  assert.throws(() => createContentSecurityPolicy(validNonce, {reportTo: "/\\\\evil.test/report"}), /Reporting API endpoint/);
});

test("standalone handler overwrites inbound nonce and sets request and response headers", async () => {
  const request = new NextRequest("https://example.test/account", {headers: {"x-nonce": "attacker"}});
  const response = await createXssSbydHandler()(request, {});
  const nonce = response.headers.get("x-middleware-request-x-nonce");
  assert.match(nonce, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(nonce, "attacker");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.match(response.headers.get("content-security-policy"), new RegExp(`nonce-${nonce}`));
  assert.match(response.headers.get("x-middleware-request-content-security-policy"), new RegExp(`nonce-${nonce}`));
});

test("wrapper preserves redirects, cookies, and inner forwarded headers while xss-sbyd wins controls", async () => {
  let innerNonce;
  const wrapped = withXssSbydHeaders((request) => {
    innerNonce = request.headers.get("x-nonce");
    const forwarded = new Headers(request.headers);
    forwarded.set("x-user", "authenticated");
    forwarded.set("x-nonce", "inner-must-not-win");
    const response = NextResponse.redirect(new URL("/login", request.url), {headers: {"x-inner": "yes"}});
    response.cookies.set("session", "checked");
    const carrier = NextResponse.next({request: {headers: forwarded}});
    for (const [name, value] of carrier.headers) response.headers.set(name, value);
    return response;
  });
  const response = await wrapped(new NextRequest("https://example.test/private"), {});
  assert.match(innerNonce, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://example.test/login");
  assert.match(response.headers.get("set-cookie"), /session=checked/);
  assert.equal(response.headers.get("x-inner"), "yes");
  assert.equal(response.headers.get("x-middleware-request-x-user"), "authenticated");
  assert.equal(response.headers.get("x-middleware-request-x-nonce"), innerNonce);
});

test("wrapper preserves inner deletion of client-supplied headers", async () => {
  const wrapped = withXssSbydHeaders((request) => {
    const forwarded = new Headers(request.headers);
    forwarded.delete("x-user");
    forwarded.delete("authorization");
    forwarded.set("x-inner-marker", "checked");
    return NextResponse.next({request: {headers: forwarded}});
  });
  const response = await wrapped(new NextRequest("https://example.test/private", {
    headers: {"x-user": "attacker-admin", authorization: "Bearer attacker-token"},
  }), {});
  const names = response.headers.get("x-middleware-override-headers").split(",");
  assert.equal(names.includes("x-user"), false);
  assert.equal(names.includes("authorization"), false);
  assert.equal(response.headers.get("x-middleware-request-x-inner-marker"), "checked");
});

test("report-only mode changes only the response header and undefined inner responses continue", async () => {
  const response = await withXssSbydHeaders(() => undefined, {mode: "report-only", reportUri: "/csp-report"})(
    new NextRequest("https://example.test/"),
    {},
  );
  assert.equal(response.headers.has("content-security-policy"), false);
  assert.match(response.headers.get("content-security-policy-report-only"), /strict-dynamic/);
  assert.match(response.headers.get("content-security-policy-report-only"), /report-uri \/csp-report; report-to next-xss-sbyd-csp$/);
  assert.equal(response.headers.get("reporting-endpoints"), 'next-xss-sbyd-csp="https://example.test/csp-report"');
  assert.match(response.headers.get("x-middleware-request-content-security-policy"), /strict-dynamic/);
});

test("report-only mode preserves an enforced baseline policy from inner middleware", async () => {
  const response = await withXssSbydHeaders(
    () => NextResponse.next({headers: {"Content-Security-Policy": "default-src 'self'"}}),
    {mode: "report-only"},
  )(new NextRequest("https://example.test/"), {});

  assert.equal(response.headers.get("content-security-policy"), "default-src 'self'");
  assert.match(response.headers.get("content-security-policy-report-only"), /strict-dynamic/);
});

test("report-only mode preserves unrelated Reporting API endpoints", async () => {
  const response = await withXssSbydHeaders(
    () => NextResponse.next({headers: {"Reporting-Endpoints": 'errors="https://reports.example.test/errors"'}}),
    {mode: "report-only", reportUri: "/csp-report"},
  )(new NextRequest("https://example.test/"), {});

  assert.equal(
    response.headers.get("reporting-endpoints"),
    'errors="https://reports.example.test/errors", next-xss-sbyd-csp="https://example.test/csp-report"',
  );
});

test("wrapper augments immutable standard redirect and error responses", async () => {
  const request = new NextRequest("https://example.test/");
  const redirect = await withXssSbydHeaders(() => Response.redirect("https://example.test/next", 308))(request, {});
  assert.equal(redirect.status, 308);
  assert.equal(redirect.statusText, "");
  assert.equal(redirect.headers.get("location"), "https://example.test/next");
  assert.match(redirect.headers.get("content-security-policy"), /strict-dynamic/);

  const error = await withXssSbydHeaders(() => Response.error())(request, {});
  assert.equal(error.status, 0);
  assert.equal(error.type, "error");
  assert.equal(error.body, null);
  assert.match(error.headers.get("content-security-policy"), /strict-dynamic/);
});

test("wrapped errors propagate unchanged", async () => {
  const expected = new Error("middleware failed");
  await assert.rejects(
    () => withXssSbydHeaders(() => { throw expected; })(new NextRequest("https://example.test/"), {}),
    (error) => error === expected,
  );
});

test("CSP report handler normalizes legacy reports without reflecting their contents", async () => {
  const reports = [];
  const handler = createCspReportHandler({log: (report) => reports.push(report)});
  const response = await handler(new Request("https://example.test/api/csp-report", {
    method: "POST",
    headers: {"content-type": "application/csp-report; charset=UTF-8"},
    body: JSON.stringify({"csp-report": {
      "blocked-uri": "https://cdn.example.test/private/image.png?token=secret#fragment",
      "script-sample": "x".repeat(300),
      "violated-directive": "IMG-SRC-ELEM https://example.test",
    }}),
  }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await response.text(), "");
  assert.deepEqual(reports, [{
    blockedOrigin: "https://cdn.example.test",
    sample: "x".repeat(256),
    violatedDirective: "img-src-elem",
  }]);
});

test("CSP report handler accepts Reporting API batches and deduplicates a batch", async () => {
  const reports = [];
  const report = {
    type: "csp-violation",
    body: {blockedURL: "blob:https://example.test/id", effectiveDirective: "media-src", sample: "play()"},
  };
  const response = await createCspReportHandler({log: async (value) => reports.push(value)})(
    new Request("https://example.test/api/csp-report", {
      method: "POST",
      headers: {"content-type": "application/reports+json"},
      body: JSON.stringify([report, report, {type: "network-error", body: report.body}, null]),
    }),
  );
  assert.equal(response.status, 204);
  assert.deepEqual(reports, [{blockedOrigin: "blob:", sample: "play()", violatedDirective: "media-src"}]);
});

test("CSP report handler rejects empty or excessive Reporting API batches", async () => {
  const reports = [];
  const handler = createCspReportHandler({log: (report) => reports.push(report), maxReports: 1});
  const request = (body) => new Request("https://example.test/api/csp-report", {
    method: "POST",
    headers: {"content-type": "application/reports+json"},
    body: JSON.stringify(body),
  });
  assert.equal((await handler(request([{type: "network-error", body: {}}]))).status, 400);
  assert.equal((await handler(request([
    {type: "csp-violation", body: {blockedURL: "https://a.test/x", effectiveDirective: "img-src"}},
    {type: "csp-violation", body: {blockedURL: "https://b.test/x", effectiveDirective: "img-src"}},
  ]))).status, 413);
  assert.deepEqual(reports, []);
});

test("CSP report handler rejects a malformed CSP entry instead of silently accepting a partial batch", async () => {
  const reports = [];
  const handler = createCspReportHandler({log: (report) => reports.push(report)});
  const response = await handler(new Request("https://example.test/api/csp-report", {
    method: "POST",
    headers: {"content-type": "application/reports+json"},
    body: JSON.stringify([
      {type: "csp-violation", body: {blockedURL: "https://a.test/x", effectiveDirective: "img-src"}},
      {type: "csp-violation", body: {blockedURL: "https://b.test/x"}},
    ]),
  }));
  assert.equal(response.status, 400);
  assert.deepEqual(reports, []);
});

test("CSP report handler retains bounded diagnostic metadata and non-URL browser keywords", async () => {
  const reports = [];
  const handler = createCspReportHandler({log: (report) => reports.push(report)});
  const response = await handler(new Request("https://example.test/api/csp-report", {
    method: "POST",
    headers: {"content-type": "application/csp-report"},
    body: JSON.stringify({"csp-report": {
      "blocked-uri": "wasm-eval",
      "column-number": 8,
      "disposition": "report",
      "document-uri": "https://example.test/account?secret=removed#fragment",
      "line-number": 12,
      "original-policy": "default-src 'self'",
      "referrer": "https://example.test/start?private=yes",
      "source-file": "https://example.test/assets/app.js?build=private",
      "status-code": 200,
      "violated-directive": "script-src",
    }}),
  }));
  assert.equal(response.status, 204);
  assert.deepEqual(reports, [{
    blockedOrigin: "wasm-eval",
    columnNumber: 8,
    disposition: "report",
    documentURL: "https://example.test/account",
    lineNumber: 12,
    originalPolicy: "default-src 'self'",
    referrer: "https://example.test/start",
    sample: "",
    sourceFile: "https://example.test/assets/app.js",
    statusCode: 200,
    violatedDirective: "script-src",
  }]);
});

test("CSP report handler sanitizes samples and deduplicates normalized reports", async () => {
  const reports = [];
  const handler = createCspReportHandler({log: (report) => reports.push(report)});
  const response = await handler(new Request("https://example.test/api/csp-report", {
    method: "POST",
    headers: {"content-type": "application/reports+json"},
    body: JSON.stringify([
      {
        type: "csp-violation",
        body: {
          blockedURL: "https://CDN.example.test:443/a.js",
          effectiveDirective: "SCRIPT-SRC-ELEM",
          sample: "first\nsecond\u0000third",
        },
      },
      {
        type: "csp-violation",
        body: {
          blockedURL: "https://cdn.example.test/b.js",
          effectiveDirective: "script-src-elem",
          sample: "first second third",
        },
      },
    ]),
  }));
  assert.equal(response.status, 204);
  assert.deepEqual(reports, [{
    blockedOrigin: "https://cdn.example.test",
    sample: "first second third",
    violatedDirective: "script-src-elem",
  }]);
});

test("CSP report handler rejects unsupported, malformed, and oversized requests", async () => {
  const handler = createCspReportHandler({log() {}, maxBytes: 8});
  for (const [request, status] of [
    [new Request("https://example.test/report"), 405],
    [new Request("https://example.test/report", {method: "POST", body: "{}"}), 415],
    [new Request("https://example.test/report", {method: "POST", headers: {"content-type": "application/csp-report"}, body: "{"}), 400],
    [new Request("https://example.test/report", {method: "POST", headers: {"content-type": "application/csp-report"}, body: "{}"}), 400],
    [new Request("https://example.test/report", {method: "POST", headers: {"content-type": "application/reports+json"}, body: "{}"}), 400],
    [new Request("https://example.test/report", {method: "POST", headers: {"content-type": "application/csp-report"}, body: new Uint8Array([0xff])}), 400],
    [new Request("https://example.test/report", {method: "POST", headers: {"content-type": "application/csp-report", "content-length": "9"}, body: "{}"}), 413],
    [new Request("https://example.test/report", {method: "POST", headers: {"content-type": "application/csp-report"}, body: "123456789"}), 413],
  ]) {
    const response = await handler(request);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.throws(() => createCspReportHandler({}), /log callback/);
  assert.throws(() => createCspReportHandler({log() {}, maxBytes: 0}), /positive integer/);
  assert.throws(() => createCspReportHandler({log() {}, maxReports: 0}), /positive integer/);
});

test("report-to-policy suggestions emit exact origins and flag unsafe broadening", () => {
  assert.deepEqual(reportsToCspOptions([
    {violatedDirective: "img-src-elem", blockedOrigin: "https://b.example.test", sample: ""},
    {violatedDirective: "img-src", blockedOrigin: "https://a.example.test", sample: ""},
    {violatedDirective: "img-src", blockedOrigin: "https://a.example.test", sample: ""},
    {violatedDirective: "media-src", blockedOrigin: "blob:", sample: ""},
    {violatedDirective: "script-src-elem", blockedOrigin: "inline", sample: "alert(1)"},
    {violatedDirective: "script-src", blockedOrigin: "data:", sample: ""},
    {violatedDirective: "connect-src", blockedOrigin: "https:", sample: ""},
    {violatedDirective: "worker-src", blockedOrigin: "https://ignored.example.test", sample: ""},
    {violatedDirective: "constructor", blockedOrigin: "https://ignored.example.test", sample: ""},
  ]), {
    options: {
      imgSrc: ["'self'", "https://a.example.test", "https://b.example.test"],
      mediaSrc: ["'self'", "blob:"],
    },
    warnings: [
      "script-src blocked inline content; do not add 'unsafe-inline'",
      "script-src blocked data:; strict-dynamic ignores host allowlists, so fix nonce propagation instead",
      "connect-src proposed broad source https:; add an exact trusted origin instead",
      "worker-src has no configurable xss-sbyd option; investigate this violation manually",
      "constructor has no configurable xss-sbyd option; investigate this violation manually",
    ],
  });
});

test("report-to-policy suggestions never automate executable or authority-changing directives", () => {
  assert.deepEqual(reportsToCspOptions([
    {violatedDirective: "script-src", blockedOrigin: "https://scripts.example.test", sample: ""},
    {violatedDirective: "style-src", blockedOrigin: "https://styles.example.test", sample: ""},
    {violatedDirective: "form-action", blockedOrigin: "https://forms.example.test", sample: ""},
    {violatedDirective: "frame-src", blockedOrigin: "https://frames.example.test", sample: ""},
  ]), {
    options: {styleSrc: ["'self'", "https://styles.example.test"]},
    warnings: [
      "script-src blocked https://scripts.example.test; strict-dynamic ignores host allowlists, so fix nonce propagation instead",
      "form-action blocked https://forms.example.test; review this submission destination manually",
      "frame-src blocked https://frames.example.test; review the framed origin and sandbox policy manually",
    ],
  });
});

test("report-to-policy suggestions warn for unsupported directives and unrecognized sources", () => {
  assert.deepEqual(reportsToCspOptions([
    {violatedDirective: "worker-src", blockedOrigin: "https://workers.example.test", sample: ""},
    {violatedDirective: "img-src", blockedOrigin: "unrecognized", sample: ""},
    {violatedDirective: "script-src", blockedOrigin: "wasm-eval", sample: ""},
  ]), {
    options: {},
    warnings: [
      "worker-src has no configurable xss-sbyd option; investigate this violation manually",
      "img-src reported unrecognized; no safe automatic policy suggestion is available",
      "script-src blocked wasm-eval; strict-dynamic ignores host allowlists, so fix nonce propagation instead",
    ],
  });
});

test("reporting endpoint configuration emits both Reporting API controls", async () => {
  const response = await withXssSbydHeaders(() => undefined, {reportTo: "/api/csp-report"})(
    new NextRequest("https://example.test/"),
    {},
  );
  assert.match(response.headers.get("content-security-policy"), /report-to xss-sbyd/u);
  assert.equal(response.headers.get("reporting-endpoints"), 'xss-sbyd="https://example.test/api/csp-report"');
});
