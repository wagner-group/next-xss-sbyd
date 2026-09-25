import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdir, open, readFile, rm} from "node:fs/promises";

await mkdir(new URL("../tmp/playwright-csp/", import.meta.url), {recursive: true});
const reportPath = new URL("../tmp/playwright-csp/report.json", import.meta.url);
await rm(reportPath, {force: true});
const log = await open(new URL("../tmp/playwright-csp/runner.log", import.meta.url), "w");
const child = spawn(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config", "tests/playwright-csp/playwright.config.mjs", "--reporter=json"], {stdio: ["ignore", log.fd, log.fd], env: {...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath.pathname}});
const exitCode = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", resolve); });
await log.close();
const report = JSON.parse(await readFile(reportPath, "utf8"));
assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
let count = 0;
let intentionalFailures = 0;
function failurePattern(title, project) {
  if (title === "streaming response explicit association deadline") return /response association failed or timed out after 100 ms \(frame-\d+, http:\/\/[^)]+\/streaming\); the document CSP header was not checked/;
  if (title === "FAIL parser sandbox without scripts") return project === "firefox" ? /Enforcing policy 1 has a sandbox directive that blocks scripts/ : /CSP observer document was replaced/;
  if (/^FAIL invalid quiet settings .*association timeout$/.test(title)) return /cspObservation requires a positive integer associationTimeoutMs/;
  if (/^FAIL invalid quiet/.test(title)) return /cspObservation requires positive integer quietMs < timeoutMs/;
  if (title === "FAIL bypass configuration") return /CSP observation does not support bypassCSP: true/;
  if (title === "FAIL precreated context") return /CSP observation requires a context without precreated pages/;
  if (/^FAIL policy (missing|meta|report)$|^FAIL initial popup nonce |^FAIL download response/.test(title)) {
    return /Nonce policy assertion requires an enforcing Content-Security-Policy response header/;
  }
  if (title === "FAIL policy mismatch") return /selected script nonce does not match the strict policy/;
  if (/^FAIL policy (first-duplicate|empty-nonce|two-nonces)$/.test(title)) return /script-src must contain exactly one valid, nonempty nonce source/;
  if (title === "FAIL policy unsafe") return /script-src-elem must contain exactly one valid, nonempty nonce source/;
  if (title === "FAIL policy attr") return /Unsupported script-src-attr override: it must be exactly 'none'/;
  if (/^FAIL policy (eval|wasm|inline)$/.test(title)) return /script-src contains an unsupported unsafe script keyword/;
  if (title === "FAIL policy second-blocks") return /Enforcing policy 2 has an unsupported script-element source list/;
  if (title === "FAIL selector .absent") return /The script selector did not match any elements/;
  if (title === "FAIL selector h1") return /Every selected element must be an HTMLScriptElement/;
  if (title === "FAIL reused nonce on same URL reload") return /Nonce reused across distinct documents in this test/;
  if (title === "FAIL setContent response evidence") return /CSP observer document was replaced/;
  if (title === "FAIL missing initialization in live document") return /Missing CSP observer initialization/;
  if (title === "FAIL expected missing") return /Expected CSP violation count was not received/;
  if (/^FAIL expected (extra|disposition|source|unrelated)$|^FAIL expectation wrong frame$/.test(title)) return /CSP expectation did not match exact interval: wanted 1, matched \d+, received \d+/;
  if (title === "FAIL expected navigate") return /Expectation document was replaced/;
  if (title === "FAIL expected action") return /Intentional action failure/;
  if (title === "FAIL expected behavior" || title === "FAIL teardown also records violations after body failure") return /expect\(received\)\.toBe\(expected\)/;
  if (title === "FAIL continuous violations bounded flush") return /CSP observation error \[(chromium|firefox|webkit)\]:.*(quiet interval|timed out)/;
  if (title === "FAIL foreign context assertion") return /Nonce assertion requires a page in the observed context/;
  if (title === "FAIL nested expectation") return /Nested or simultaneous CSP expectations are unsupported/;
  if (/^FAIL invalid expectation |^FAIL missing assertion callback$/.test(title)) return /CSP expectation requires exact directive, disposition, blocked URI, positive count, and two callbacks/;
  if (title === "FAIL context closed before observation teardown") return /observed context closed before collection completed/;
  if (/^FAIL automatic |^FAIL initial document |^FAIL initial violations in frames |^FAIL initial violation in noopener |^FAIL retained through navigation |^FAIL earlier records |^FAIL later identical record |^FAIL sandboxed srcdoc |^FAIL blocked blob script |^PASS retry starts /.test(title)) {
    return /Unexpected CSP violations \[(chromium|firefox|webkit), project (chromium|firefox|webkit)\]: [1-9]\d*/;
  }
  throw new Error(`Missing precise failure expectation for ${title}`);
}
async function inspect(suite) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests) {
      count++;
      const retryScenario = spec.title.includes("retry starts");
      assert.equal(test.results.length, retryScenario ? 2 : 1, `${spec.title}: unexpected retry count`);
      for (const result of test.results) {
        const details = (result.errors ?? []).map((error) => error.message ?? "").join("\n");
        if (spec.title.startsWith("FAIL ") || (spec.title === "streaming response explicit association deadline" && test.projectName === "chromium") || (retryScenario && result.retry === 0)) {
          intentionalFailures++;
          assert.equal(result.status, "failed", `${test.projectName}: ${spec.title}\n${details}`);
          // A later teardown violation must not mask the wrong primary failure.
          assert.match((result.errors?.[0]?.message ?? "").replace(/\u001b\[[0-9;]*m/g, ""), failurePattern(spec.title, test.projectName), `${test.projectName}: ${spec.title}: wrong failure\n${details}`);
        } else {
          assert.equal(result.status, "passed", `${test.projectName}: ${spec.title}\n${details}`);
        }
        const attachment = result.attachments.find((item) => item.name === "csp-observation.json");
        assert.ok(attachment, `${spec.title}: missing CSP attachment`);
        if (attachment) {
          const raw = attachment.body ? Buffer.from(attachment.body, "base64").toString() : await readFile(attachment.path, "utf8");
          const artifact = JSON.parse(raw);
          assert.equal(artifact.schemaVersion, 1);
          assert.equal(artifact.browser, test.projectName);
          assert.equal(artifact.project, test.projectName);
          assert.ok(Array.isArray(artifact.violations));
          assert.ok(Array.isArray(artifact.expectedSequences));
          assert.ok(Array.isArray(artifact.observationErrors));
          assert.ok(artifact.limitations.some((item) => /worker/i.test(item)));
          if (/expected blocked attack|exact source matching/.test(spec.title)) {
            assert.equal(artifact.violations.length, 1);
            assert.deepEqual(artifact.expectedSequences, [1]);
          }
          if (retryScenario) {
            assert.deepEqual(artifact.violations.map((record) => record.sequence), [1]);
            assert.deepEqual(artifact.expectedSequences, result.retry === 0 ? [] : [1]);
          }
          if (/identical native events/.test(spec.title)) {
            assert.equal(artifact.violations.length, 2);
            assert.deepEqual(artifact.expectedSequences, [1, 2]);
          }
          if (/initial document |initial violations in frames/.test(spec.title)) {
            assert.deepEqual(artifact.observationErrors, [], `${test.projectName}: ${spec.title}`);
            const expectedCount = /initial violations in frames/.test(spec.title) ? 3 : spec.title.startsWith("FAIL ") ? 1 : 0;
            assert.equal(artifact.violations.length, expectedCount, `${test.projectName}: ${spec.title}`);
            if (expectedCount) {
              assert.equal(result.errors.length, 1, "Only the automatic CSP teardown rejection may fail");
              assert.match(result.errors[0].message, new RegExp(`^Error: Unexpected CSP violations \\[${test.projectName}, project ${test.projectName}\\]: ${expectedCount}\\n`));
            }
            if (expectedCount === 3) {
              assert.equal(new Set(artifact.violations.map((record) => record.frameId)).size, 3);
              assert.equal(new Set(artifact.violations.map((record) => record.pageId)).size, 2);
            }
          }
          if (/initial popup nonce/.test(spec.title)) {
            assert.deepEqual(artifact.observationErrors, []);
            assert.deepEqual(artifact.violations, []);
            if (spec.title.startsWith("FAIL ")) {
              assert.equal(result.errors.length, 1);
              assert.match(details, /Nonce policy assertion requires an enforcing Content-Security-Policy response header/);
            }
          }
          if (/initial violation in noopener/.test(spec.title)) {
            assert.equal(artifact.violations.length, 1);
            assert.deepEqual(artifact.observationErrors, []);
          }
          if (/retained through navigation/.test(spec.title)) {
            assert.equal(artifact.violations.length, 2);
            assert.deepEqual(artifact.expectedSequences, []);
          }
          if (/sandboxed srcdoc/.test(spec.title)) {
            assert.equal(result.errors.length, 1, "Only CSP teardown must reject the sandboxed frame");
            assert.deepEqual(artifact.observationErrors, []);
            assert.equal(artifact.violations[0].documentURL, "about:");
          }
          if (/missing expectation can be caught/.test(spec.title)) assert.deepEqual(artifact.observationErrors, []);
          if (/missing initialization|continuous violations|setContent response/.test(spec.title)) assert.ok(artifact.observationErrors.length > 0);
          assert.doesNotMatch(raw, /QUERY_SECRET|FRAGMENT_SECRET|SCRIPT_CONTENT_SECRET|ATTACK_CONTENT_SECRET|cmV1c2VkLW5vbmNl|d3Jvbmc=|'nonce-/);
          assert.doesNotMatch(details, /QUERY_SECRET|FRAGMENT_SECRET|SCRIPT_CONTENT_SECRET|ATTACK_CONTENT_SECRET|cmV1c2VkLW5vbmNl|d3Jvbmc=|'nonce-/);
        }
      }
    }
  }
  for (const nested of suite.suites ?? []) await inspect(nested);
}
for (const suite of report.suites) await inspect(suite);
assert.ok(count >= 100, `Only ${count} browser scenarios ran`);
assert.ok(intentionalFailures > 0);
assert.equal(exitCode, 1, "The nested runner must fail for the intentionally rejected scenarios");
console.log(`Verified ${count} real-browser scenarios, including ${intentionalFailures} expected runner failures.`);
