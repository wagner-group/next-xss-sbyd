import assert from "node:assert/strict";
import {createServer} from "node:http";
import {mkdir, writeFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {createRequire} from "node:module";
import {build} from "esbuild";
import {chromium} from "playwright-core";
import {chromePath} from "./test-native-pdf.mjs";

const root = new URL("../", import.meta.url);
const fixture = process.argv[2];
assert(fixture === undefined || ["next14", "next15", "next16"].includes(fixture), "Expected next14, next15, or next16");
const dependencies = new URL(fixture ? `fixtures/${fixture}/node_modules/` : "node_modules/", root);
const alias = Object.fromEntries(["react", "react-dom"].map(name => [name, new URL(name, dependencies).pathname]));
const output = new URL(`tmp/sanitized-html-view-${fixture ?? "workspace"}/`, root);
await mkdir(output, {recursive: true});
if (fixture) {
  const config = new URL("types.json", output);
  await writeFile(config, JSON.stringify({
    extends: new URL("type-fixtures/tsconfig.json", root).pathname,
    compilerOptions: {paths: {
      react: [new URL("@types/react/index.d.ts", dependencies).pathname],
      "react/*": [new URL("@types/react/*", dependencies).pathname],
    }},
  }));
  const result = spawnSync(process.execPath, [new URL("node_modules/typescript/bin/tsc", root).pathname, "-p", config.pathname], {encoding: "utf8"});
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
const definition = {'process.env.NODE_ENV': '"development"'};
const initial = {as: "article", value: '<b>bold</b><em>emphasis</em><script>window.attacked=true</script><a href="javascript:alert(1)">link</a>', id: "content", className: "prose"};
const require = createRequire(import.meta.url);
const ssrPath = new URL("ssr.cjs", output).pathname;
await build({
  stdin: {contents: `
    const {createElement} = require("react");
    const {renderToString} = require("react-dom/server");
    const {SanitizedHtmlView} = require("next-xss-sbyd/sanitized-html-view");
    exports.render = function render(props) {
      return renderToString(createElement(SanitizedHtmlView, props));
    };
  `, resolveDir: root.pathname},
  bundle: true, platform: "node", format: "cjs", packages: "external", outfile: ssrPath, define: definition,
  // Bundle both sides of the SafeHtml boundary together so CJS/ESM SafeValues
  // constructors cannot be mixed by the synthetic server bundle.
  alias: {...alias,
    "next-xss-sbyd/sanitize": new URL("packages/next-xss-sbyd/dist/sanitize-node.js", root).pathname,
    "next-xss-sbyd/sanitized-html-view": new URL("packages/next-xss-sbyd/dist/sanitized-html-view.js", root).pathname,
  },
});
const ssr = require(ssrPath).render(initial);
assert.equal(ssr, '<article id="content" class="prose"><b>bold</b><em>emphasis</em><a>link</a></article>');
const common = {bundle: true, platform: "browser", format: "iife", write: false, metafile: true, alias: {...alias, "react-dom/server": new URL("react-dom/server.browser.js", dependencies).pathname}, define: definition};
const app = await build({...common, entryPoints: [new URL("tests/sanitized-html-view/browser.mjs", root).pathname]});
const failureProbe = `
  import {createElement} from "react";
  import {renderToStaticMarkup} from "react-dom/server";
  import {SanitizedHtmlView} from "next-xss-sbyd/sanitized-html-view";
  function probe() {
    try {
      renderToStaticMarkup(createElement(SanitizedHtmlView, {value: "<b>safe</b>"}));
      return "NOT REJECTED";
    } catch (error) { return error.message; }
  }
`;
const worker = await build({...common, stdin: {contents: failureProbe + 'self.onmessage = () => self.postMessage(probe());', resolveDir: root.pathname}});
const edge = await build({...common, conditions: ["edge-light", "browser"], stdin: {contents: failureProbe + 'window.edgeViewError = probe();', resolveDir: root.pathname}});
for (const [name, bundle] of Object.entries({app, worker, edge})) {
  const forbidden = name === "edge" ? /(?:^|\/)(?:jsdom|dompurify)(?:\/|$)/ : /(?:^|\/)jsdom(?:\/|$)/;
  assert.deepEqual(Object.keys(bundle.metafile.inputs).filter(path => forbidden.test(path)), [], `${name}: forbidden DOM engine in bundle`);
}
const bundles = {"/app.js": app, "/worker.js": worker, "/edge.js": edge};
const server = createServer((request, response) => {
  if (request.url in bundles) {
    response.setHeader("Content-Type", "text/javascript");
    response.end(bundles[request.url].outputFiles[0].contents);
  } else {
    response.setHeader("Content-Type", "text/html");
    if (request.url === "/engine-failure") response.setHeader("Content-Security-Policy", "require-trusted-types-for 'script'; trusted-types 'none'");
    response.end(`<!doctype html><html><head><title>Sanitized view fixture</title></head><body><div id="root">${request.url === "/engine-failure" ? "" : ssr}</div><script src="/app.js"></script><script src="/edge.js"></script></body></html>`);
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, ...(fixture ? {executablePath: await chromePath()} : {})});
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin);
  await page.waitForFunction(() => window.viewHarness?.ready());
  assert.equal(await page.locator("#root").innerHTML(), ssr);
  assert.deepEqual(await page.evaluate(() => window.viewHarness.errors), []);
  assert.deepEqual(errors, []);
  assert.equal(await page.evaluate(() => window.attacked), undefined);
  assert.match(await page.evaluate(() => window.edgeViewError), /Edge sanitization is unsupported/);
  assert.match(await page.evaluate(() => new Promise(resolve => {
    const worker = new Worker("/worker.js");
    worker.onmessage = event => { worker.terminate(); resolve(event.data); };
    worker.postMessage("run");
  })), /workers without a DOM are unsupported/);
  assert.equal(await page.evaluate(() => window.viewHarness.render({
    as: "article", value: '<strong>updated</strong><script>window.attacked=true</script>', id: "content",
  })), true, "Changing content must update the existing container");
  assert.equal(await page.locator("#content").innerHTML(), "<strong>updated</strong>");
  assert.equal(await page.evaluate(() => window.attacked), undefined);
  for (const as of [undefined, "article", "aside", "div", "footer", "header", "main", "nav", "section", "span"]) {
    for (const callback of [false, true]) {
      const props = {as, value: '<b>selected</b><img src="javascript:alert(1)" onerror="window.attacked=true">', id: "content"};
      for (let repetition = 0; repetition < 2; repetition++) {
        await page.evaluate(({props, callback}) => window.viewHarness.render(props, callback), {props, callback});
        const result = await page.evaluate(callback => window.viewHarness.inspect(callback), callback);
        assert.equal(result.tag, as ?? "div");
        assert.equal(result.selected, "selected");
        assert.equal(result.html, '<b>selected</b><img referrerpolicy="no-referrer">');
        assert.equal(result.sameMarkup, true);
        assert.equal(result.connected, true);
      }
    }
  }
  await page.evaluate(() => window.viewHarness.render({value: ""}));
  assert.equal(await page.locator("#root").innerHTML(), "<div></div>");
  assert.equal(await page.evaluate(() => window.viewHarness.render({value: "<em>replacement</em>"})), true);
  assert.equal(await page.locator("#root").innerHTML(), "<div><em>replacement</em></div>");
  assert.equal(await page.evaluate(() => window.viewHarness.render({value: ""})), true);
  assert.equal(await page.locator("#root").innerHTML(), "<div></div>");
  for (const props of [
    {value: null}, {value: "text", as: "script"},
    ...["html", "children", "innerHTML", "dangerouslySetInnerHTML", "VALUE"].map(name => ({value: "safe", [name]: "<script>unsafe</script>"})),
  ]) {
    await page.evaluate(props => window.viewHarness.render(props), props);
    assert.match(await page.locator("#failure").textContent(), /requires a string|Unsafe .* prop|Unsafe SafeBlock container/);
    assert.equal(await page.locator("#root script").count(), 0);
  }
  await page.evaluate(() => window.viewHarness.render({value: "<em>recovered</em>"}));
  assert.equal(await page.locator("#root").innerHTML(), "<div><em>recovered</em></div>");
  assert.deepEqual(await page.evaluate(() => window.viewHarness.unmount()), {object: null, callback: null});
  await page.goto(`${origin}/engine-failure`);
  assert.match(await page.locator("#failure").textContent(), /sanitiz.*failed|engine/i);
  assert.equal(await page.locator("#root script, #root b").count(), 0);
  console.log(`${fixture ?? "workspace"}: SSR/hydration, container refs, selection/scrolling, rerenders, forged spreads, errors, browser/Edge graphs and worker rejection passed`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
