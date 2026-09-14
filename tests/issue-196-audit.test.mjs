import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";

const workspace = fileURLToPath(new URL("../", import.meta.url));
const cli = join(workspace, "packages/next-xss-sbyd/dist/cli.js");

async function app(t, source) {
  await mkdir(join(workspace, "tmp"), {recursive: true});
  const root = await mkdtemp(join(workspace, "tmp/issue-196-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  await writeFile(join(root, "package.json"), JSON.stringify({name: "style-fixture", type: "module",
    dependencies: {next: "16.3.4", react: "19.2.8", "next-xss-sbyd": "0.0.0"}}));
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({compilerOptions: {
    jsx: "preserve", jsxImportSource: "next-xss-sbyd"}, include: ["**/*.tsx", "**/*.ts"]}));
  await writeFile(join(root, "eslint.config.mjs"), 'import plugin from "eslint-plugin-next-xss-sbyd"; export default [...plugin.configs.lintMigration];');
  await writeFile(join(root, "page.tsx"), source);
  return root;
}

function audit(root, ...args) {
  const result = spawnSync(process.execPath, [cli, "audit", root, "--stage", "lint", ...args], {
    cwd: workspace, encoding: "utf8",
  });
  assert.equal(result.error, undefined);
  return {...result, report: args.includes("--json") && result.stdout ? JSON.parse(result.stdout) : undefined};
}

test("audit accepts inline styles without compatibility findings or a style budget", async (t) => {
  const source = 'export default function Page({color}: {color: string}) { return <div style={{color, padding: 8}} />; }';
  const root = await app(t, source);
  const result = audit(root, "--json", "--max-warnings", "0");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(result.report.findings, []);
  assert.equal(Object.hasOwn(result.report, "styleFindings"), false);
  assert.equal(Object.hasOwn(result.report, "styleCounts"), false);
  assert.equal(result.report.diagnostics.some(({id}) => id.startsWith("audit.style-")), false);
  const clean = audit(root, "--json", "--fail-on-warning");
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  const text = audit(root);
  assert.doesNotMatch(text.stdout, /CSP COMPATIBILITY|migrate.*style|CSS Modules/);
  assert.equal(await readFile(join(root, "page.tsx"), "utf8"), source);
  const removedOption = audit(root, "--max-style-warnings", "0");
  assert.equal(removedOption.status, 2);
  assert.match(removedOption.stderr, /Unknown option: --max-style-warnings/);
});

test("inline style props do not hide existing security findings", async (t) => {
  const root = await app(t, 'export default function Page({html}: {html: string}) { return <div style={{color: "red"}} dangerouslySetInnerHTML={{__html: html}} />; }');
  const result = audit(root, "--json", "--max-warnings", "0");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.ok(result.report.findings.some(({category}) => category === "raw-html"));
  assert.ok(result.report.diagnostics.some(({id}) => id === "audit.warning-budget"));
});
