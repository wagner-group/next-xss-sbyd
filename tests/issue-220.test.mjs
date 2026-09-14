import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const workspace = fileURLToPath(new URL("../", import.meta.url));
const cli = join(workspace, "packages/next-xss-sbyd/dist/cli.js");

async function createApp(t, stage, {preload = true, instrumentation = false} = {}) {
  await mkdir(join(workspace, "tmp"), {recursive: true});
  const root = await mkdtemp(join(workspace, "tmp/issue-220-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "issue-220-fixture", type: "module",
    dependencies: {next: "16.3.4", react: "19.2.8", "next-xss-sbyd": "0.0.0"},
    scripts: preload ? {start: "NODE_OPTIONS='--import next-xss-sbyd/enforce/preload' next start"} : {},
  }));
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({compilerOptions: {
    jsx: "preserve", jsxImportSource: "next-xss-sbyd",
  }, include: ["**/*.tsx", "**/*.ts"]}));
  const preset = ["recommended", "csp-report", "enforce"].includes(stage) ? "recommended" : "lintMigration";
  await writeFile(join(root, "eslint.config.mjs"),
    `import plugin from "eslint-plugin-next-xss-sbyd"; export default [...plugin.configs.${preset}];`);
  await writeFile(join(root, "page.tsx"), 'export default function Page() { return <div />; }');
  if (stage !== "lint") {
    await writeFile(join(root, "next.config.ts"), [
      'const aliases = {"next/link": "next-xss-sbyd/compat/link", "next/image": "next-xss-sbyd/compat/image", "next/form": "next-xss-sbyd/compat/form"};',
      'export default {turbopack: {resolveAlias: aliases}, webpack(config) {config.resolve.alias = {...config.resolve.alias, ...aliases}; return config;}};',
    ].join("\n"));
    if (instrumentation) {
      await writeFile(join(root, "instrumentation.ts"), [
        'export async function register() {',
        '  if (process.env.NEXT_RUNTIME === "nodejs") {',
        '    const {installResponseGuard} = await import("next-xss-sbyd/enforce");',
        '    installResponseGuard();',
        '  }',
        '}',
      ].join("\n"));
    }
  }
  if (["csp-report", "enforce"].includes(stage)) {
    await writeFile(join(root, "proxy.ts"),
      'import {createXssSbydHandler} from "next-xss-sbyd/csp"; export const proxy = createXssSbydHandler({mode: "' + (stage === "csp-report" ? "report-only" : "enforce") + '"});');
  }
  return root;
}

async function audit(root, stage, ...args) {
  let result;
  try {
    result = {...await execFileAsync(process.execPath, [cli, "audit", root, "--stage", stage, ...args], {cwd: workspace}), status: 0};
  } catch (error) {
    assert.equal(typeof error.code, "number");
    result = {...error, status: error.code};
  }
  return {...result, report: args.includes("--json") ? JSON.parse(result.stdout) : undefined};
}

for (const stage of ["lint", "runtime", "recommended", "csp-report", "enforce"]) {
  test(`clean ${stage} audit passes --fail-on-warning`, async (t) => {
    const root = await createApp(t, stage);
    const result = await audit(root, stage, "--json", "--fail-on-warning");
    assert.equal(result.status, 0, result.stdout);
    assert.equal(result.report.complete, true);
    assert.deepEqual(result.report.diagnostics.filter(({status}) => status !== "pass"), []);
    assert.equal(result.report.diagnostics.find(({id}) => id === "audit.response-inventory").status, "pass");
    for (const id of ["runtime.pending", "csp.pending"]) {
      const expected = id === "runtime.pending" ? stage === "lint" : ["lint", "runtime", "recommended"].includes(stage);
      const diagnostic = result.report.diagnostics.find((item) => item.id === id);
      assert.equal(diagnostic?.status, expected ? "pass" : undefined, `${stage}: ${id}`);
    }
    assert.equal(result.report.diagnostics.find(({id}) => id === "audit.response-inventory").action,
      "No heuristic response sites were found; nothing to review.");
    const text = await audit(root, stage, "--fail-on-warning");
    assert.equal(text.status, 0, text.stdout);
    assert.match(text.stdout, /\[PASS\] audit.response-inventory/u);
    assert.doesNotMatch(text.stdout, /Review HTML constructors/u);
  });
}

test("preload remains recognized alongside instrumentation", async (t) => {
  const root = await createApp(t, "enforce", {instrumentation: true});
  const result = await audit(root, "enforce", "--json", "--fail-on-warning");
  assert.equal(result.status, 0, result.stdout);
  assert.equal(result.report.diagnostics.find(({id}) => id === "runtime.preload-order").status, "pass");
});

for (const warning of ["audit.response-inventory", "audit.recommended-scope", "runtime.preload-order"]) {
  test(`${warning} alone makes --fail-on-warning exit 1`, async (t) => {
    const stage = warning === "runtime.preload-order" ? "enforce" : "lint";
    const root = await createApp(t, stage, {preload: false, instrumentation: true});
    if (warning === "audit.response-inventory") {
      await writeFile(join(root, "response.ts"), 'export function data() { return new Response("ok", {headers: {"Content-Type": "text/plain"}}); }');
    }
    const options = warning === "audit.recommended-scope" ? ["--recommended"] : [];
    const ordinary = await audit(root, stage, "--json", ...options);
    assert.equal(ordinary.status, 0, ordinary.stdout);
    const result = await audit(root, stage, "--json", "--fail-on-warning", ...options);
    assert.equal(result.status, 1, result.stdout);
    assert.equal(result.report.complete, true);
    assert.deepEqual(result.report.diagnostics.filter(({status}) => status === "warning").map(({id}) => id), [warning]);
    const text = await audit(root, stage, "--fail-on-warning", ...options);
    assert.equal(text.status, 1, text.stdout);
    assert.ok(text.stdout.includes(`[WARNING] ${warning}`));
  });
}

test("missing runtime guard remains an error", async (t) => {
  const root = await createApp(t, "runtime", {preload: false});
  const result = await audit(root, "runtime", "--json", "--fail-on-warning");
  assert.equal(result.status, 1, result.stdout);
  assert.equal(result.report.complete, false);
  assert.equal(result.report.diagnostics.find(({id}) => id === "runtime.response-guard").status, "error");
  assert.equal(result.report.diagnostics.find(({id}) => id === "runtime.preload-order").status, "warning");
});

for (const [name, fields] of [
  ["development script", {scripts: {dev: "NODE_OPTIONS='--import next-xss-sbyd/enforce/preload' next dev", start: "next start"}}],
  ["test script", {scripts: {test: "node --import next-xss-sbyd/enforce/preload --test", start: "next start"}}],
  ["description", {description: "--import next-xss-sbyd/enforce/preload", scripts: {start: "next start"}}],
  ["quoted different module", {scripts: {start: 'node --import "next-xss-sbyd/enforce/preload"-other server.js'}}],
  ["different module", {scripts: {start: "NODE_OPTIONS='--import next-xss-sbyd/enforce/preload-other' next start"}}],
]) {
  for (const instrumentation of [false, true]) {
    test(`${name} cannot pass preload check (instrumentation: ${instrumentation})`, async (t) => {
      const root = await createApp(t, "runtime", {instrumentation});
      const file = join(root, "package.json");
      const pkg = JSON.parse(await readFile(file, "utf8"));
      await writeFile(file, JSON.stringify({...pkg, ...fields}));
      const result = await audit(root, "runtime", "--json", "--fail-on-warning");
      assert.equal(result.status, 1, result.stdout);
      assert.equal(result.report.diagnostics.find(({id}) => id === "runtime.preload-order").status, "warning");
      assert.equal(result.report.diagnostics.find(({id}) => id === "runtime.response-guard")?.status, instrumentation ? undefined : "error");
    });
  }
}

for (const start of [
  'node --import=next-xss-sbyd/enforce/preload server.js',
  'node --import "next-xss-sbyd/enforce/preload" server.js',
  "node --import='next-xss-sbyd/enforce/preload' server.js",
]) {
  test(`start preload is recognized: ${start}`, async (t) => {
    const root = await createApp(t, "runtime");
    const file = join(root, "package.json");
    const pkg = JSON.parse(await readFile(file, "utf8"));
    await writeFile(file, JSON.stringify({...pkg, scripts: {start}}));
    const result = await audit(root, "runtime", "--json", "--fail-on-warning");
    assert.equal(result.status, 0, result.stdout);
    assert.equal(result.report.diagnostics.find(({id}) => id === "runtime.preload-order").status, "pass");
  });
}

for (const [name, source] of [
  ["missing package", undefined],
  ["null package", "null"],
  ["missing scripts", "{}"],
  ["missing start", '{"scripts":{}}'],
  ["non-string start", '{"scripts":{"start":42}}'],
  ["invalid JSON", "{"],
]) {
  test(`standalone guard check rejects ${name}`, async (t) => {
    await mkdir(join(workspace, "tmp"), {recursive: true});
    const root = await mkdtemp(join(workspace, "tmp/issue-220-guard-"));
    t.after(() => rm(root, {recursive: true, force: true}));
    if (source !== undefined) await writeFile(join(root, "package.json"), source);
    await assert.rejects(execFileAsync(process.execPath,
      [join(workspace, "packages/next-xss-sbyd/dist/check-guard.js"), root]), {code: 1});
  });
}
