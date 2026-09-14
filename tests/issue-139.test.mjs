import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";

const workspace = fileURLToPath(new URL("../", import.meta.url));

test("audit fails closed on fatal TypeScript parsing errors", async (t) => {
  await mkdir(join(workspace, "tmp"), {recursive: true});
  const root = await mkdtemp(join(workspace, "tmp", "issue-139-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  await writeFile(join(root, "package.json"), JSON.stringify({name: "fixture", type: "module", dependencies: {next: "16.3.4", react: "19.2.8", "next-xss-sbyd": "0.0.0"}}));
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({compilerOptions: {jsx: "preserve"}, include: ["**/*.tsx"]}));
  await writeFile(join(root, "eslint.config.mjs"), 'import xssSbyd from "eslint-plugin-next-xss-sbyd"; export default [...xssSbyd.configs.lintMigration];');
  await writeFile(join(root, "page.tsx"), "export default function Page() { return <main ; }\n");
  const result = spawnSync(process.execPath, [join(workspace, "packages/next-xss-sbyd/dist/cli.js"), "audit", root, "--stage", "lint", "--json"], {encoding: "utf8", cwd: workspace});
  const report = JSON.parse(result.stdout);
  assert.equal(result.status, 2);
  assert.equal(report.complete, false);
  assert.ok(report.diagnostics.some((item) => item.id === "audit.failed"));
});
