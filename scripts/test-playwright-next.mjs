import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {mkdir, readFile, rm} from "node:fs/promises";
import {createServer} from "node:net";
import {fileURLToPath} from "node:url";
import {setTimeout as delay} from "node:timers/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
const nextCli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const reportPath = new URL("../tmp/playwright-next/report.json", import.meta.url);
await mkdir(new URL("../tmp/playwright-next/", import.meta.url), {recursive: true});
await rm(reportPath, {force: true});

/** Run a child command and return its exit code. */
async function run(args, env = process.env) {
  const child = spawn(process.execPath, args, {cwd: root, env, stdio: "inherit"});
  return (await once(child, "exit"))[0];
}

assert.equal(await run([nextCli, "build", "tests/playwright-next", "--webpack"]), 0, "Next production build failed");
const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [nextCli, "start", "tests/playwright-next", "--hostname", "127.0.0.1", "--port", String(port)], {cwd: root, stdio: "inherit"});
const serverExit = once(server, "exit");

try {
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline) {
    assert.equal(server.exitCode, null, "Next server exited before readiness");
    try { ready = (await fetch(origin, {signal: AbortSignal.timeout(1_000)})).ok; } catch {}
    if (ready) break;
    await delay(100);
  }
  assert.ok(ready, "Next production server did not become ready");
  const exitCode = await run(["node_modules/@playwright/test/cli.js", "test", "--config", "tests/playwright-next/playwright.config.mjs"], {...process.env, PLAYWRIGHT_NEXT_URL: origin});
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.deepEqual(report.errors, []);
  let passed = 0;
  let rejected = 0;
  /** Check both successful workflows and the reason for intentional runner failures. */
  async function inspect(suite) {
    for (const spec of suite.specs ?? []) for (const result of spec.tests) {
      assert.equal(result.results.length, 1);
      const run = result.results[0];
      const details = run.errors.map((error) => error.message ?? "").join("\n");
      const attachment = run.attachments.find((item) => item.name === "csp-observation.json");
      assert.ok(attachment, `${result.projectName}: ${spec.title}: missing observation attachment`);
      const raw = attachment.body ? Buffer.from(attachment.body, "base64").toString() : await readFile(attachment.path, "utf8");
      const observation = JSON.parse(raw);
      if (spec.title.startsWith("FAIL ")) {
        assert.equal(run.status, "failed", details);
        assert.match(details, /unexpected.*CSP|CSP.*violation/is);
        assert.ok(observation.violations.some((entry) => entry.effectiveDirective === "script-src-elem" && entry.disposition === "enforce" && entry.blockedURI === "inline"));
        rejected++;
      } else {
        assert.equal(run.status, "passed", details);
        assert.deepEqual(observation.violations, []);
        passed++;
      }
    }
    for (const child of suite.suites ?? []) await inspect(child);
  }
  for (const suite of report.suites) await inspect(suite);
  assert.equal(passed, 3);
  assert.equal(rejected, 3);
  assert.equal(exitCode, 1, "Intentional initial violations must fail the nested runner");
  console.log("Verified production Next.js hydration, styles, navigation, nonce freshness and automatic failures in three browsers.");
} finally {
  server.kill("SIGTERM");
  await serverExit;
}
