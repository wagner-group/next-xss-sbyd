import assert from "node:assert/strict";
import {access, mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {ESLint} from "eslint";
import {chromium} from "playwright-core";
import plugin from "../eslint-plugin-next-xss-sbyd/dist/index.js";
import {installResponseGuard} from "next-xss-sbyd/enforce";

async function chromePath() {
  for (const candidate of [process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium",
  ].filter(Boolean)) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next installed browser.
    }
  }
  return undefined;
}

const executablePath = await chromePath();

test("recommended lint rejects guarded routes whose header deletion permits HTML sniffing", {
  skip: executablePath ? false : "Chrome unavailable; set CHROME_PATH for the browser regression",
}, async (t) => {
  const temporaryRoot = fileURLToPath(new URL("../tmp/", import.meta.url));
  await mkdir(temporaryRoot, {recursive: true});
  const root = await mkdtemp(join(temporaryRoot, "issue-206-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: {jsx: "react-jsx", jsxImportSource: "next-xss-sbyd", lib: ["ES2022", "DOM"]},
    include: ["app/**/*.ts"],
  }));
  const cases = [[], ["Content-Type"], ["X-Content-Type-Options"], ["Content-Type", "X-Content-Type-Options"]].map(removed => ({
    mutation: removed.map(header => `response.headers.delete(${JSON.stringify(header)});`).join("\n"),
    findings: removed.map(() => "remove"),
    type: removed.includes("Content-Type") ? undefined : "text/plain",
    options: removed.includes("X-Content-Type-Options") ? undefined : "nosniff",
    executes: removed.length === 2,
  }));
  for (const type of ["", "garbage"]) {
    for (const disableNosniff of [false, true]) {
      cases.push({
        mutation: `response.headers.set("Content-Type", ${JSON.stringify(type)}); ${disableNosniff ? 'response.headers.set("X-Content-Type-Options", "sniff");' : ''}`,
        findings: disableNosniff ? ["invalidMedia", "nosniff"] : ["invalidMedia"],
        type, options: disableNosniff ? "sniff" : "nosniff", executes: disableNosniff,
      });
    }
  }
  const routes = [];
  for (const [index, scenario] of cases.entries()) {
    const directory = join(root, "app/api", String(index));
    await mkdir(directory, {recursive: true});
    const code = `export function GET(request) {
      const body = new URL(request.url).searchParams.get("body") ?? "";
      const response = new Response(body, {headers: {"Content-Type": "text/plain", "X-Content-Type-Options": "nosniff"}});
      ${scenario.mutation}
      return response;
    }`;
    await writeFile(join(directory, "route.ts"), code);
    // Execute exactly the linted route source; these TypeScript fixtures use
    // JavaScript syntax so no compiler transform or test double is necessary.
    routes.push((await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`)).GET);
  }
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: plugin.configs.recommended.map((entry) => entry.languageOptions ? {
      ...entry,
      languageOptions: {...entry.languageOptions, parserOptions: {
        ...entry.languageOptions.parserOptions, tsconfigRootDir: root,
      }},
    } : entry),
  });
  const results = await eslint.lintFiles(["app/**/*.ts"]);
  assert.deepEqual(results.map(({messages}) => messages.map(({ruleId, messageId}) => [ruleId, messageId])),
    cases.map(({findings}) => [["xss-sbyd/require-safe-route-handler", "wrapper"], ...findings.map(message => ["xss-sbyd/no-html-content-type", message]) ]));

  installResponseGuard();
  const server = createServer(async (request, outgoing) => {
    try {
      const url = new URL(request.url, "http://localhost");
      const route = routes[Number(url.pathname.slice(1))];
      if (!route) { outgoing.writeHead(404).end(); return; }
      const response = route(new Request(url));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(await response.text());
    } catch (error) {
      outgoing.writeHead(500).end(String(error));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const browser = await chromium.launch({headless: true, executablePath});
  t.after(() => browser.close());
  for (const [index, scenario] of cases.entries()) {
    const page = await browser.newPage();
    const payload = '<!doctype html><script>window.xssProof="executed"</script>';
    const response = await page.goto(`http://127.0.0.1:${server.address().port}/${index}?body=${encodeURIComponent(payload)}`);
    assert.equal(response.status(), 200);
    const headers = await response.allHeaders();
    assert.equal(headers["content-type"], scenario.type);
    assert.equal(headers["x-content-type-options"], scenario.options);
    assert.equal(await page.evaluate(() => window.xssProof), scenario.executes ? "executed" : undefined);
    await page.close();
  }
});
