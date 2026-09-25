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
function failurePattern(title) {
  if (title.includes("invalid quiet")) return /quietMs|positive|integer/i;
  if (title.includes("bypass")) return /bypassCSP/i;
  if (title.includes("precreated")) return /already|existing|pre.?created|before.*page/i;
  if (title.includes("policy") || title.includes("selector") || title.includes("nonce") || title.includes("setContent")) return /nonce|policy|script|response|document/i;
  if (title.includes("body failure") || title.includes("behavior")) return /Expected|expect\(/i;
  if (title.includes("action")) return /Intentional action failure/;
  return /CSP|violation|observation|document/i;
}
async function inspect(suite) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests) {
      count++;
      const retryScenario = spec.title.includes("retry starts");
      assert.equal(test.results.length, retryScenario ? 2 : 1, `${spec.title}: unexpected retry count`);
      for (const result of test.results) {
        const details = (result.errors ?? []).map((error) => error.message ?? "").join("\n");
        if (spec.title.startsWith("FAIL ") || (retryScenario && result.retry === 0)) {
          intentionalFailures++;
          assert.equal(result.status, "failed", `${test.projectName}: ${spec.title}\n${details}`);
          assert.match(details, failurePattern(spec.title), `${test.projectName}: ${spec.title}: wrong failure\n${details}`);
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
              assert.match(result.errors[0].message, new RegExp(`^Error: Unexpected CSP violations: ${expectedCount}\\n`));
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
