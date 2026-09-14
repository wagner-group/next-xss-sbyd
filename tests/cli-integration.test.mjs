import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const cli = join(workspaceRoot, "packages/next-xss-sbyd/dist/cli.js");
const cleanPage = "export default function Page() { return <main />; }\n";
const migrationConfig = 'import xssSbyd from "eslint-plugin-next-xss-sbyd";\nexport default [...xssSbyd.configs.lintMigration];\n';

async function createApp(t) {
  const temporaryRoot = join(workspaceRoot, "tmp");
  await mkdir(temporaryRoot, { recursive: true });
  const root = await mkdtemp(join(temporaryRoot, "cli-integration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "cli-integration-fixture",
    type: "module",
    dependencies: { next: "16.3.4", react: "19.2.8", "next-xss-sbyd": "0.0.0" },
  }));
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { jsx: "preserve", jsxImportSource: "next-xss-sbyd" },
    include: ["**/*.tsx"],
  }));
  await writeFile(join(root, "eslint.config.mjs"), migrationConfig);
  await writeFile(join(root, "page.tsx"), cleanPage);
  return root;
}

function runCli(root, command, ...options) {
  const result = spawnSync(process.execPath, [
    cli, command, root, "--stage", "lint", "--json", ...options,
  ], { encoding: "utf8", cwd: workspaceRoot });
  assert.equal(result.error, undefined);
  assert.ok(result.stdout, result.stderr);
  return { status: result.status, report: JSON.parse(result.stdout) };
}

test("CLI audit covers a clean application without changing its source", async (t) => {
  const root = await createApp(t);
  const before = await readFile(join(root, "page.tsx"), "utf8");
  const { status, report } = runCli(root, "audit");
  assert.equal(status, 0);
  assert.equal(report.complete, true);
  assert.deepEqual(report.findings, []);
  assert.ok(report.fileScope.includes("page.tsx"));
  assert.equal(await readFile(join(root, "page.tsx"), "utf8"), before);
});

test("CLI audit warning ratchet rejects real raw HTML findings", async (t) => {
  const root = await createApp(t);
  await writeFile(join(root, "page.tsx"),
    'export default function Page() { return <main dangerouslySetInnerHTML={{__html: "<p>unsafe</p>"}} />; }\n');
  const { status, report } = runCli(root, "audit", "--max-warnings", "0");
  assert.equal(status, 1);
  assert.ok(report.findings.some((finding) => finding.ruleId === "xss-sbyd/no-danger"));
  assert.ok(report.diagnostics.some((diagnostic) => diagnostic.id === "audit.warning-budget"));
});

async function configureRuntime(root, nextMajor) {
  const packagePath = join(root, "package.json");
  const metadata = JSON.parse(await readFile(packagePath, "utf8"));
  metadata.dependencies.next = `${nextMajor}.0.0`;
  metadata.devDependencies = {
    eslint: "10.9.1",
    "eslint-plugin-next-xss-sbyd": "0.0.0",
    "@typescript-eslint/parser": "8.69.0",
    typescript: "5.9.2",
  };
  metadata["next-xss-sbyd"] = { stage: "lint" };
  await writeFile(packagePath, JSON.stringify(metadata));
  await writeFile(join(root, "instrumentation.ts"),
    'export async function register() { if (process.env.NEXT_RUNTIME === "nodejs") { (await import("next-xss-sbyd/enforce")).installResponseGuard(); } }\n');
  await writeFile(join(root, "next.config.mjs"),
    'const aliases = {"next/link": "next-xss-sbyd/compat/link", "next/image": "next-xss-sbyd/compat/image", "next/form": "next-xss-sbyd/compat/form"};\nexport default {turbopack: {resolveAlias: aliases}, webpack(config) { config.resolve.alias = {...config.resolve.alias, ...aliases}; return config; }};\n');
}

test("CLI CSP discovery recognizes a src proxy integration", async (t) => {
  const root = await createApp(t);
  await configureRuntime(root, 16);
  await mkdir(join(root, "src/app"), {recursive: true});
  await rename(join(root, "page.tsx"), join(root, "src/app/page.tsx"));
  await writeFile(join(root, "src/proxy.ts"),
    'import {createXssSbydHandler} from "next-xss-sbyd/csp";\nexport const proxy = createXssSbydHandler();\n');
  const { report } = runCli(root, "check-config", "--stage", "enforce");
  assert.equal(report.diagnostics.some((diagnostic) => diagnostic.id === "csp.missing"), false);
  assert.ok(report.diagnostics.some((diagnostic) => diagnostic.id === "csp.configured"));
});

test("CSP suggestion CLI accepts an empty report file", async (t) => {
  const root = await createApp(t);
  const reports = join(root, "reports.json");
  await writeFile(reports, "[]");
  const result = spawnSync(process.execPath, [
    join(workspaceRoot, "packages/next-xss-sbyd/dist/csp-suggest.js"), reports,
  ], { encoding: "utf8", cwd: workspaceRoot });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {});
});

test("CLI inventories explicit Pages HTML sinks and audits wrapper coverage", async (t) => {
  const root = await createApp(t);
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: {jsx: "preserve", jsxImportSource: "next-xss-sbyd", module: "NodeNext", moduleResolution: "NodeNext"},
    include: ["**/*.tsx"],
  }));
  await mkdir(join(root, "pages/api"), {recursive: true});
  await writeFile(join(root, "pages/api/html.tsx"), [
    'import {htmlEscape} from "next-xss-sbyd";',
    'import {withSafeApiRoute} from "next-xss-sbyd/enforce";',
    'export default withSafeApiRoute((_req, res) => {',
    '  res.status(201).safeSend(htmlEscape("safe"));',
    '});',
  ].join("\n"));
  await writeFile(join(root, "pages/api/plain.tsx"), [
    'import type {NextApiRequest, NextApiResponse} from "next";',
    'export default function handler(_req: NextApiRequest, res: NextApiResponse) {',
    '  res.json({ok: true});',
    '}',
  ].join("\n"));
  const {status, report} = runCli(root, "audit", "--max-warnings", "0");
  assert.equal(status, 1);
  const missing = report.findings.filter((finding) => finding.ruleId === "xss-sbyd/require-safe-api-route");
  assert.equal(missing.length, 1, JSON.stringify(report.findings, null, 2));
  assert.equal(missing[0].file, "pages/api/plain.tsx");
  assert.equal(missing[0].category, "api-route-setup");
  assert.equal(missing[0].setup, false);
  assert.ok(report.diagnostics.some((diagnostic) => diagnostic.id === "audit.warning-budget"));
  const inventory = report.diagnostics.find((diagnostic) => diagnostic.id === "audit.response-inventory");
  assert.match(inventory.evidence, /pages\/api\/html\.tsx:4:\d+ safeSend/u);
});

test("CLI check-config rejects disabling the Pages wrapper rule", async (t) => {
  const root = await createApp(t);
  await writeFile(join(root, "eslint.config.mjs"), [
    'import xssSbyd from "eslint-plugin-next-xss-sbyd";',
    'export default [...xssSbyd.configs.lintMigration, {rules: {"xss-sbyd/require-safe-api-route": "off"}}];',
  ].join("\n"));
  const {status, report} = runCli(root, "check-config");
  assert.equal(status, 1);
  const weakened = report.diagnostics.find((diagnostic) => diagnostic.id === "eslint.preset-weakened");
  assert.ok(weakened);
  assert.match(weakened.evidence, /xss-sbyd\/require-safe-api-route/u);
});

test("response inventory includes safe constructors, methods, and Node streams", async (t) => {
  const root = await createApp(t);
  await writeFile(join(root, "page.tsx"), [
    'new SafeResponse(html, {headers: {"Content-Type": "text/html; charset=utf-8"}});',
    'new SafeNextResponse(stream);',
    'response.status(201).safeSend(html);',
    'response.safeEnd(html, done);',
    'safePipe(response, stream);',
  ].join("\n"));
  const result = spawnSync(process.execPath, [
    join(workspaceRoot, "packages/next-xss-sbyd/dist/inventory.js"), root, "--json",
  ], {encoding: "utf8", cwd: workspaceRoot});
  assert.equal(result.status, 0, result.stderr);
  const inventory = JSON.parse(result.stdout);
  assert.deepEqual(inventory.map((item) => [item.constructor, item.line, item.contentType]), [
    ["SafeResponse", 1, "text/html; charset=utf-8"],
    ["SafeNextResponse", 2, null],
    ["safeSend", 3, null],
    ["safeEnd", 4, null],
    ["safePipe", 5, null],
  ]);
});
