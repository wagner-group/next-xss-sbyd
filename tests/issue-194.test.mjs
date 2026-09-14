import assert from "node:assert/strict";
import test from "node:test";

import {NextRequest} from "next/server.js";
import {createContentSecurityPolicy, createCspReportHandler, createXssSbydHandler} from "next-xss-sbyd/csp";

const nonce = "abcdefghijklmnopqrstuv";
const sourceOptions = {
  scriptSrc: "script-src",
  styleSrc: "style-src",
  connectSrc: "connect-src",
  imgSrc: "img-src",
  fontSrc: "font-src",
  mediaSrc: "media-src",
  frameSrc: "frame-src",
  formAction: "form-action",
};

test("CSP report receiver accepts WebKit's Reporting API envelope sent as application/csp-report", async () => {
  const reports = [];
  const handler = createCspReportHandler({log: (report) => reports.push(report), maxReports: 1});
  const envelope = {
    type: "csp-violation",
    url: "https://example.test/csp-styles?private=removed",
    body: {
      documentURL: "https://example.test/csp-styles?private=removed",
      blockedURL: "inline",
      effectiveDirective: "style-src-elem",
      disposition: "report",
      sample: "first\nsecond",
    },
  };
  function request(body) {
    return new Request("https://example.test/api/csp-report", {
      method: "POST",
      headers: {"content-type": "application/csp-report"},
      body: JSON.stringify(body),
    });
  }
  const response = await handler(request(envelope));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await response.text(), "");
  assert.deepEqual(reports, [{
    blockedOrigin: "inline",
    violatedDirective: "style-src-elem",
    documentURL: "https://example.test/csp-styles",
    disposition: "report",
    sample: "first second",
  }]);
  for (const malformed of [null, 1, "report", {}, envelope.body, [envelope], {body: envelope.body}, {type: "network-error", body: envelope.body}, {type: "csp-violation"}, {type: "csp-violation", body: {}}, {type: "csp-violation", body: [envelope.body]}]) {
    assert.equal((await handler(request(malformed))).status, 400, JSON.stringify(malformed));
  }
  const bounded = createCspReportHandler({log: (report) => reports.push(report), maxBytes: 8});
  assert.equal((await bounded(request(envelope))).status, 413);
  assert.equal(reports.length, 1, "invalid or oversized envelopes must not be logged");
});

test("CSP report receiver preserves WebKit legacy reports with Reporting API metadata", async () => {
  const reports = [];
  const handler = createCspReportHandler({log: (report) => reports.push(report)});
  const response = await handler(new Request("https://example.test/api/csp-report", {
    method: "POST",
    headers: {"content-type": "application/csp-report"},
    body: JSON.stringify({
      type: "csp-violation",
      url: "https://example.test/csp-styles",
      "csp-report": {
        "document-uri": "https://example.test/csp-styles",
        "blocked-uri": "inline",
        "effective-directive": "style-src-attr",
        disposition: "enforce",
      },
    }),
  }));
  assert.equal(response.status, 204);
  assert.deepEqual(reports, [{
    documentURL: "https://example.test/csp-styles",
    blockedOrigin: "inline",
    violatedDirective: "style-src-attr",
    disposition: "enforce",
    sample: "",
  }]);
});

for (const environment of ["development", "production"]) {
  test(`CSP caller source validation and middleware behavior in ${environment}`, async () => {
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = environment;
    try {
      for (const [option, directive] of Object.entries(sourceOptions)) {
        for (const source of ["'unsafe-inline'", "'unsafe-eval'", "'UNSAFE-INLINE'", "'UNSAFE-EVAL'", "'UnSaFe-InLiNe'", "'UnSaFe-EvAl'"]) {
          const options = {[option]: [source]};
          assert.throws(() => createContentSecurityPolicy(nonce, options), (error) => {
            assert.ok(error instanceof TypeError);
            assert.ok(error.message.includes(option), error.message);
            assert.ok(error.message.includes(source), error.message);
            assert.match(error.message, /nonce|trusted|remove/i);
            return true;
          }, `${environment} ${option} must reject ${source}`);
          await assert.rejects(createXssSbydHandler(options)(new NextRequest("https://example.test/"), {}), TypeError);
        }
        for (const source of ["", "https://a.test https://b.test", "https://a.test\t", "https://a.test\n", "https://a.test\u0000", "https://a.test\u007f", "https://a.test,https://b.test", "https://a.test;script-src *"]) {
          assert.throws(() => createContentSecurityPolicy(nonce, {[option]: [source]}), {
            name: "TypeError",
            message: new RegExp(`Invalid CSP ${directive} source`),
          });
        }
        const sources = ["'self'", "https://assets.example.test", "https://assets.example.test/unsafe-inline.css"];
        const policy = createContentSecurityPolicy(nonce, {[option]: sources});
        const values = policy.split("; ").find((entry) => entry.startsWith(`${directive} `)).split(" ").slice(1);
        for (const source of sources) assert.ok(values.includes(source), `${option}: ${source}`);
        assert.doesNotThrow(() => createContentSecurityPolicy(nonce, {[option]: []}));
      }

      for (const mode of ["enforce", "report-only"]) {
        const response = await createXssSbydHandler({mode, reportTo: "/api/csp-report"})(new NextRequest("https://example.test/"), {});
        const header = mode === "enforce" ? "content-security-policy" : "content-security-policy-report-only";
        const policy = response.headers.get(header);
        const forwardedNonce = response.headers.get("x-middleware-request-x-nonce");
        assert.match(forwardedNonce, /^[A-Za-z0-9_-]{22}$/);
        assert.ok(policy.includes(`'nonce-${forwardedNonce}'`));
        assert.equal(response.headers.get("x-middleware-request-content-security-policy"), policy);
        assert.equal(response.headers.get("reporting-endpoints"), 'xss-sbyd="https://example.test/api/csp-report"');
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
        assert.deepEqual(policy.split("; ").filter(value => value.includes("'unsafe-inline'")), ["style-src 'self' 'unsafe-inline'", "style-src-attr 'unsafe-inline'"]);
        const evalDirectives = policy.split("; ").filter((value) => value.includes("'unsafe-eval'"));
        assert.equal(evalDirectives.length, environment === "development" ? 1 : 0);
        if (environment === "development") assert.ok(evalDirectives[0].startsWith("script-src "));
      }
    } finally {
      if (previousEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnvironment;
    }
  });
}
