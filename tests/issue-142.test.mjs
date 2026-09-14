import assert from "node:assert/strict";
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import test from "node:test";
import {checkCsp} from "../packages/next-xss-sbyd/dist/config-check.js";
import {discoverProject} from "../packages/next-xss-sbyd/dist/project.js";
test("CSP discovery finds proxy in a src application", async (t) => {
  const temporary = new URL("../tmp/", import.meta.url).pathname;
  await mkdir(temporary, {recursive: true});
  const root = await mkdtemp(join(temporary, "issue-142-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, "src/app"), {recursive: true});
  await writeFile(join(root, "package.json"), JSON.stringify({dependencies: {next: "16.3.4"}}));
  await writeFile(join(root, "src/app/page.tsx"), "export default function Page() { return null; }");
  await writeFile(join(root, "src/proxy.ts"), 'import {createXssSbydHandler} from "next-xss-sbyd/csp"; export const proxy = createXssSbydHandler();');
  const diagnostics = await checkCsp(await discoverProject(root), "enforce");
  assert.equal(diagnostics.some((item) => item.id === "csp.missing"), false);
  assert.ok(diagnostics.some((item) => item.id === "csp.configured"));
});
