import assert from "node:assert/strict";
import {readFile, mkdir, writeFile, mkdtemp, rm} from "node:fs/promises";
import {createServer} from "node:http";
import {join, resolve} from "node:path";
import test from "node:test";
import {pathToFileURL} from "node:url";
import {ESLint} from "eslint";
import plugin from "../eslint-plugin-next-xss-sbyd/dist/index.js";
import {installResponseGuard} from "next-xss-sbyd/enforce";
import {withSafeRouteHandler} from "next-xss-sbyd/route-handler";

test("documented CSS exception passes recommended lint and serves under the runtime guard", async t => {
  const readme = await readFile("eslint-plugin-next-xss-sbyd/README.md", "utf8");
  const source = readme.match(/```ts\n(\/\/ eslint-disable-next-line xss-sbyd\/require-safe-route-handler[\s\S]*?)\n```/u)[1];
  await mkdir(resolve("tmp"), {recursive: true});
  const root = await mkdtemp(resolve("tmp/css-example-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const route = join(root, "app/api/example");
  await mkdir(route, {recursive: true});
  await writeFile(join(route, "route.ts"), source);
  await writeFile(join(route, "route.mjs"), source);
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: {strict: true, lib: ["ES2022", "DOM"], jsx: "react-jsx", jsxImportSource: "next-xss-sbyd"},
    include: ["app/**/*.ts"],
  }));
  const eslint = new ESLint({cwd: root, overrideConfigFile: true,
    overrideConfig: plugin.configs.recommended.map(entry => entry.languageOptions ? {
      ...entry, languageOptions: {...entry.languageOptions, parserOptions: {
        ...entry.languageOptions.parserOptions, tsconfigRootDir: root,
      }},
    } : entry),
  });
  assert.deepEqual((await eslint.lintFiles(["app/**/*.ts"])).flatMap(result => result.messages), []);
  installResponseGuard();
  const {GET} = await import(pathToFileURL(join(route, "route.mjs")).href);
  await assert.rejects(withSafeRouteHandler(GET)(), {code: "XSS_SBYD_UNSAFE_ROUTE_RESPONSE"});
  const server = createServer(async function serve(request, outgoing) {
    const result = GET();
    outgoing.writeHead(result.status, Object.fromEntries(result.headers));
    outgoing.end(await result.text());
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/css");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await response.text(), "body { color: navy; }");
});
