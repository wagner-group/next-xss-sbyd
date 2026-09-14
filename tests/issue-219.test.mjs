import assert from "node:assert/strict";
import {access, mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import {join} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import test from "node:test";
import {ESLint} from "eslint";
import {chromium} from "playwright-core";
import plugin from "../eslint-plugin-next-xss-sbyd/dist/index.js";
import {installResponseGuard} from "next-xss-sbyd/enforce";
import {withSafeRouteHandler} from "next-xss-sbyd/route-handler";

/** Finds Chrome using the same optional-browser convention as issue-206. */
async function chromePath() {
  for (const candidate of [process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium",
  ].filter(Boolean)) {
    try { await access(candidate); return candidate; } catch { /* Try the next installation. */ }
  }
  return undefined;
}
const executablePath = await chromePath();

test("recommended lint rejects guarded routes that relabel attacker text as SVG or XML", {
  skip: executablePath ? false : "Chrome unavailable; set CHROME_PATH for the browser regression",
}, async (t) => {
  const temporaryRoot = fileURLToPath(new URL("../tmp/", import.meta.url));
  await mkdir(temporaryRoot, {recursive: true});
  const root = await mkdtemp(join(temporaryRoot, "issue-219-browser-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: {jsx: "react-jsx", jsxImportSource: "next-xss-sbyd", lib: ["ES2022", "DOM"]},
    include: ["app/**/*.ts"],
  }));
  const cases = [
    {type: "text/plain", payload: '<svg xmlns="http://www.w3.org/2000/svg"><script>window.xssProof="executed"</script></svg>', executes: false},
    {type: "image/svg+xml", payload: '<svg xmlns="http://www.w3.org/2000/svg"><script>window.xssProof="executed"</script></svg>', executes: true},
    {type: "text/xml", payload: '<html xmlns="http://www.w3.org/1999/xhtml"><script>window.xssProof="executed"</script></html>', executes: true},
    {type: "application/xml", payload: '<html xmlns="http://www.w3.org/1999/xhtml"><script>window.xssProof="executed"</script></html>', executes: true},
  ];
  const routes = [];
  for (const [index, scenario] of cases.entries()) {
    const directory = join(root, "app/api", String(index));
    await mkdir(directory, {recursive: true});
    const code = `export function GET(request) {
      const body = new URL(request.url).searchParams.get("body") ?? "";
      const response = new Response(body, {headers: {"Content-Type": "text/plain", "X-Content-Type-Options": "nosniff"}});
      response.headers.set("Content-Type", ${JSON.stringify(scenario.type)});
      return response;
    }`;
    await writeFile(join(directory, "route.ts"), code);
    // Execute the same source that the full preset checks, without test doubles.
    await writeFile(join(directory, "route.mjs"), code);
    routes.push((await import(pathToFileURL(join(directory, "route.mjs")).href)).GET);
  }
  const eslint = new ESLint({
    cwd: root, overrideConfigFile: true,
    overrideConfig: plugin.configs.recommended.map((entry) => entry.languageOptions ? {
      ...entry,
      languageOptions: {...entry.languageOptions, parserOptions: {
        ...entry.languageOptions.parserOptions, tsconfigRootDir: root,
      }},
    } : entry),
  });
  const findings = await eslint.lintFiles(["app/**/*.ts"]);
  installResponseGuard();
  const server = createServer(async (request, outgoing) => {
    const url = new URL(request.url, "http://localhost");
    const route = routes[Number(url.pathname.slice(1))];
    if (!route) { outgoing.writeHead(404).end(); return; }
    const response = route(new Request(url));
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(await response.text());
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const browser = await chromium.launch({headless: true, executablePath});
  t.after(() => browser.close());
  for (const [index, scenario] of cases.entries()) {
    const request = new Request(`http://localhost/?body=${encodeURIComponent(scenario.payload)}`);
    const guarded = withSafeRouteHandler(routes[index]);
    if (scenario.executes) {
      await assert.rejects(guarded(request), {code: "XSS_SBYD_UNSAFE_ROUTE_RESPONSE"});
    } else {
      const response = await guarded(request);
      assert.equal(response.headers.get("content-type"), "text/plain");
      assert.equal(await response.text(), scenario.payload);
    }
    const page = await browser.newPage();
    const response = await page.goto(`http://127.0.0.1:${server.address().port}/${index}?body=${encodeURIComponent(scenario.payload)}`);
    assert.equal(response.status(), 200);
    assert.equal(response.headers()["content-type"], scenario.type);
    assert.equal(response.headers()["x-content-type-options"], "nosniff");
    assert.equal(await page.evaluate(() => window.xssProof), scenario.executes ? "executed" : undefined);
    await page.close();
  }
  t.diagnostic(`Chrome ${browser.version()}: SVG/XML execute after mutation despite nosniff; text/plain does not.`);
  assert.deepEqual(findings.map(({messages}) => messages.map(({ruleId, messageId}) => [ruleId, messageId])),
    cases.map(({executes}) => [
      ["xss-sbyd/require-safe-route-handler", "wrapper"],
      ...(executes ? [["xss-sbyd/no-html-content-type", "active"]] : []),
    ]));
});
