import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const workspaceRoot = process.cwd();

async function linkPackage(root, name, target = name) {
  const modules = join(root, "node_modules");
  await mkdir(modules, { recursive: true });
  await symlink(
    join(workspaceRoot, "node_modules", target),
    join(modules, name),
    "junction",
  );
}

async function rejectedReport(args) {
  try {
    await execFileAsync(process.execPath, args);
    assert.fail("command should fail");
  } catch (error) {
    return {
      code: error.code,
      report: JSON.parse(error.stdout),
      stderr: error.stderr,
    };
  }
}

test("response inventory reports constructors and visible content types", async () => {
  const root = await mkdtemp(join(tmpdir(), "next-xss-sbyd-inventory-"));
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "src", "route.ts"),
    [
      'new Response("plain");',
      'new NextResponse("html", {headers: {"Content-Type": "text/html"}});',
    ].join("\n"),
  );
  const { stdout } = await execFileAsync(process.execPath, [
    "packages/next-xss-sbyd/dist/inventory.js",
    root,
    "--json",
  ]);
  assert.deepEqual(JSON.parse(stdout), [
    {
      column: 1,
      constructor: "Response",
      contentType: null,
      file: "src/route.ts",
      line: 1,
    },
    {
      column: 1,
      constructor: "NextResponse",
      contentType: "text/html",
      file: "src/route.ts",
      line: 2,
    },
  ]);
});

test("guard configuration check accepts instrumentation and rejects an absent install", async () => {
  const configured = await mkdtemp(join(tmpdir(), "next-xss-sbyd-configured-"));
  await writeFile(
    join(configured, "instrumentation.ts"),
    'export async function register() { (await import("next-xss-sbyd/enforce")).installResponseGuard(); }',
  );
  const present = await execFileAsync(process.execPath, [
    "packages/next-xss-sbyd/dist/check-guard.js",
    configured,
  ]);
  assert.match(present.stdout, /instrumentation\.ts/u);

  const absent = await mkdtemp(join(tmpdir(), "next-xss-sbyd-absent-"));
  await assert.rejects(
    execFileAsync(process.execPath, [
      "packages/next-xss-sbyd/dist/check-guard.js",
      absent,
    ]),
    (error) =>
      error.code === 1 &&
      /No next-xss-sbyd response-guard installation/u.test(error.stderr),
  );
});

test("published tools execute through symlinked bin entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "next-xss-sbyd-symlink-"));
  await writeFile(join(root, "route.ts"), 'new Response("plain");\n');
  const inventory = join(root, "inventory-bin");
  const guard = join(root, "guard-bin");
  await symlink(
    join(workspaceRoot, "packages/next-xss-sbyd/dist/inventory.js"),
    inventory,
  );
  await symlink(
    join(workspaceRoot, "packages/next-xss-sbyd/dist/check-guard.js"),
    guard,
  );

  const result = await execFileAsync(process.execPath, [
    inventory,
    root,
    "--json",
  ]);
  assert.equal(JSON.parse(result.stdout)[0].constructor, "Response");
  await assert.rejects(
    execFileAsync(process.execPath, [guard, root]),
    (error) =>
      error.code === 1 &&
      /No next-xss-sbyd response-guard installation/u.test(error.stderr),
  );
});

test("retrofit CLI dry-run is read-only and lint setup is idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "next-xss-sbyd-cli-"));
  const packagePath = join(root, "package.json");
  const original = `${JSON.stringify(
    {
      name: "fixture",
      dependencies: {
        next: "16.3.4",
        react: "19.2.8",
        "next-xss-sbyd": "0.0.0",
      },
      devDependencies: {
        eslint: "10.9.1",
        "eslint-plugin-next-xss-sbyd": "0.0.0",
        "@typescript-eslint/parser": "8.69.0",
        typescript: "5.9.2",
      },
    },
    null,
    2,
  )}\n`;
  await writeFile(packagePath, original);
  await writeFile(
    join(root, "tsconfig.json"),
    '{"compilerOptions": {"jsx": "preserve"}}\n',
  );

  const dry = await execFileAsync(process.execPath, [
    "packages/next-xss-sbyd/dist/cli.js",
    "enable-config",
    root,
    "--stage",
    "lint",
    "--dry-run",
    "--json",
  ]);
  assert.equal(await readFile(packagePath, "utf8"), original);
  assert.equal(
    JSON.parse(dry.stdout).changes.some(
      (change) => change.file === "eslint.config.mjs",
    ),
    true,
  );

  await execFileAsync(process.execPath, [
    "packages/next-xss-sbyd/dist/cli.js",
    "enable-config",
    root,
    "--stage",
    "lint",
    "--yes",
    "--no-install",
    "--force",
  ]);
  assert.equal(
    JSON.parse(await readFile(packagePath, "utf8"))["next-xss-sbyd"].stage,
    "lint",
  );
  const eslintConfig = await readFile(join(root, "eslint.config.mjs"), "utf8");
  await execFileAsync(process.execPath, [
    "packages/next-xss-sbyd/dist/cli.js",
    "enable-config",
    root,
    "--stage",
    "lint",
    "--yes",
    "--no-install",
    "--force",
  ]);
  assert.equal(
    await readFile(join(root, "eslint.config.mjs"), "utf8"),
    eslintConfig,
  );
});

test("enable-config rejects non-interactive confirmation with documented exit code", async () => {
  const root = await mkdtemp(join(tmpdir(), "next-xss-sbyd-confirm-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "fixture",
      dependencies: {
        next: "16.3.4",
        react: "19.2.8",
        "next-xss-sbyd": "0.0.0",
      },
      devDependencies: {
        eslint: "10.9.1",
        "eslint-plugin-next-xss-sbyd": "0.0.0",
        "@typescript-eslint/parser": "8.69.0",
        typescript: "5.9.2",
      },
    }),
  );
  await writeFile(
    join(root, "tsconfig.json"),
    '{"compilerOptions":{"jsx":"preserve"}}\n',
  );
  const result = await rejectedReport([
    "packages/next-xss-sbyd/dist/cli.js",
    "enable-config",
    root,
    "--stage",
    "lint",
    "--force",
    "--json",
  ]);
  assert.equal(result.code, 2);
  assert.equal(
    result.report.diagnostics.some(
      (item) => item.id === "enable.confirmation-required",
    ),
    true,
  );
});

test("enable-config plans missing tools without a separate legacy sanitizer install", async () => {
  const root = await mkdtemp(join(tmpdir(), "next-xss-sbyd-install-plan-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "fixture",
      dependencies: {
        next: "16.3.4",
        react: "19.2.8",
        "next-xss-sbyd": "0.0.0",
      },
      devDependencies: { "eslint-plugin-next-xss-sbyd": "0.0.0" },
    }),
  );
  await writeFile(join(root, "tsconfig.json"), "{}\n");
  const result = await execFileAsync(process.execPath, [
    "packages/next-xss-sbyd/dist/cli.js",
    "enable-config",
    root,
    "--stage",
    "lint",
    "--dry-run",
    "--sanitize-node",
    "--json",
  ]);
  const installs = JSON.parse(result.stdout).changes.filter(
    (change) => change.file === "package.json/lockfile",
  );
  assert.equal(
    installs.some((change) => change.reason.includes("isomorphic-dompurify")),
    false,
  );
  assert.equal(
    installs.some(
      (change) =>
        change.reason.includes("@typescript-eslint/parser") &&
        change.reason.includes("typescript") &&
        change.reason.includes("eslint"),
    ),
    true,
  );
  assert.equal(
    installs.some((change) =>
      change.reason.includes("eslint-plugin-next-xss-sbyd"),
    ),
    false,
  );
});

test("enable-config advances runtime after manual integrations validate", async () => {
  const root = await mkdtemp(join(tmpdir(), "next-xss-sbyd-runtime-stage-"));
  const plugin = new URL(
    "../eslint-plugin-next-xss-sbyd/dist/index.js",
    import.meta.url,
  ).href;
  const packagePath = join(root, "package.json");
  await writeFile(
    packagePath,
    JSON.stringify(
      {
        name: "fixture",
        type: "module",
        dependencies: {
          next: "16.3.4",
          react: "19.2.8",
          "next-xss-sbyd": "0.0.0",
        },
        devDependencies: {
          eslint: "10.9.1",
          "eslint-plugin-next-xss-sbyd": "0.0.0",
          "@typescript-eslint/parser": "8.69.0",
          typescript: "5.9.2",
        },
        "next-xss-sbyd": { stage: "lint" },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { jsx: "preserve", jsxImportSource: "next-xss-sbyd" },
      include: ["**/*.ts", "**/*.tsx"],
    }),
  );
  await writeFile(
    join(root, "page.tsx"),
    "export default function Page() { return <main />; }\n",
  );
  await writeFile(
    join(root, "eslint.config.mjs"),
    [
      `import xssSbyd from ${JSON.stringify(plugin)};`,
      "const config = xssSbyd.configs.lintMigration.map((entry) => entry.languageOptions ? {...entry, languageOptions: {...entry.languageOptions, parserOptions: {...entry.languageOptions.parserOptions, tsconfigRootDir: import.meta.dirname}}} : entry);",
      "export default config;",
    ].join("\n"),
  );
  await writeFile(
    join(root, "instrumentation.ts"),
    [
      "export async function register() {",
      "  if (process.env.NEXT_RUNTIME === 'nodejs') {",
      "    (await import('next-xss-sbyd/enforce')).installResponseGuard();",
      "  }",
      "}",
    ].join("\n"),
  );
  await writeFile(
    join(root, "next.config.mjs"),
    [
      "const aliases = {'next/link': 'next-xss-sbyd/compat/link', 'next/image': 'next-xss-sbyd/compat/image', 'next/form': 'next-xss-sbyd/compat/form'};",
      "export default {turbopack: {resolveAlias: aliases}, webpack(config) {config.resolve.alias = {...config.resolve.alias, ...aliases}; return config;}};",
    ].join("\n"),
  );
  await linkPackage(root, "eslint");
  await linkPackage(root, "typescript");
  await linkPackage(root, "safevalues");
  await symlink(
    join(workspaceRoot, "packages/next-xss-sbyd"),
    join(root, "node_modules", "next-xss-sbyd"),
    "junction",
  );

  await execFileAsync(process.execPath, [
    "packages/next-xss-sbyd/dist/cli.js",
    "enable-config",
    root,
    "--stage",
    "runtime",
    "--yes",
    "--force",
  ]);
  assert.equal(
    JSON.parse(await readFile(packagePath, "utf8"))["next-xss-sbyd"].stage,
    "runtime",
  );
});

test("custom page extensions prefer a standard integration suffix", async () => {
  const root = await mkdtemp(join(tmpdir(), "next-xss-sbyd-page-extension-"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "fixture",
      dependencies: {
        next: "16.3.4",
        react: "19.2.8",
        "next-xss-sbyd": "0.0.0",
      },
    }),
  );
  await writeFile(
    join(root, "next.config.mjs"),
    "export default {pageExtensions: ['mdx', 'ts', 'tsx']};\n",
  );
  await writeFile(join(root, "tsconfig.json"), "{}\n");
  const output = await execFileAsync(process.execPath, [
    "packages/next-xss-sbyd/dist/cli.js",
    "enable-config",
    root,
    "--stage",
    "runtime",
    "--dry-run",
    "--json",
  ]);
  const report = JSON.parse(output.stdout);
  assert.equal(
    report.changes.some((change) => change.file === "instrumentation.ts"),
    true,
  );
  assert.equal(
    report.changes.some((change) => change.file === "instrumentation.mdx"),
    false,
  );
});

test("enable-config reports downgrade, dirty-target, and JSX conflict refusals", async () => {
  const downgrade = await mkdtemp(join(tmpdir(), "next-xss-sbyd-downgrade-"));
  await writeFile(
    join(downgrade, "package.json"),
    JSON.stringify({
      name: "fixture",
      dependencies: { next: "16.3.4", react: "19.2.8" },
      "next-xss-sbyd": { stage: "runtime" },
    }),
  );
  const downgraded = await rejectedReport([
    "packages/next-xss-sbyd/dist/cli.js",
    "enable-config",
    downgrade,
    "--stage",
    "lint",
    "--dry-run",
    "--json",
  ]);
  assert.equal(
    downgraded.report.diagnostics.some(
      (item) => item.id === "enable.downgrade",
    ),
    true,
  );

  const dirty = await mkdtemp(join(tmpdir(), "next-xss-sbyd-dirty-"));
  await writeFile(
    join(dirty, "package.json"),
    JSON.stringify({
      name: "fixture",
      dependencies: {
        next: "16.3.4",
        react: "19.2.8",
        "next-xss-sbyd": "0.0.0",
      },
      devDependencies: {
        eslint: "10.9.1",
        "eslint-plugin-next-xss-sbyd": "0.0.0",
        "@typescript-eslint/parser": "8.69.0",
        typescript: "5.9.2",
      },
    }),
  );
  await writeFile(join(dirty, "tsconfig.json"), "{}\n");
  await execFileAsync("git", ["init", "-q"], { cwd: dirty });
  const dirtyResult = await rejectedReport([
    "packages/next-xss-sbyd/dist/cli.js",
    "enable-config",
    dirty,
    "--stage",
    "lint",
    "--yes",
    "--json",
  ]);
  assert.equal(
    dirtyResult.report.diagnostics.some(
      (item) => item.id === "enable.dirty-target",
    ),
    true,
  );

  const conflict = await mkdtemp(join(tmpdir(), "next-xss-sbyd-jsx-conflict-"));
  await writeFile(
    join(conflict, "package.json"),
    JSON.stringify({
      name: "fixture",
      dependencies: { next: "16.3.4", react: "19.2.8" },
    }),
  );
  await writeFile(
    join(conflict, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { jsxImportSource: "other-runtime" },
    }),
  );
  const conflicted = await rejectedReport([
    "packages/next-xss-sbyd/dist/cli.js",
    "enable-config",
    conflict,
    "--stage",
    "runtime",
    "--dry-run",
    "--json",
  ]);
  assert.equal(
    conflicted.report.diagnostics.some(
      (item) => item.id === "enable.jsx-conflict",
    ),
    true,
  );
});

test("audit supports recommended planning, baselines, and fail-on-warning", async () => {
  const root = await mkdtemp(join(tmpdir(), "next-xss-sbyd-baseline-"));
  const plugin = new URL(
    "../eslint-plugin-next-xss-sbyd/dist/index.js",
    import.meta.url,
  ).href;
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "fixture",
      type: "module",
      devDependencies: {typescript: "^5.9.2"},
      dependencies: {
        next: "16.3.4",
        react: "19.2.8",
        "next-xss-sbyd": "0.0.0",
      },
    }),
  );
  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { jsx: "preserve", jsxImportSource: "next-xss-sbyd" },
      include: ["**/*.tsx"],
    }),
  );
  await writeFile(
    join(root, "eslint.config.mjs"),
    `import xssSbyd from ${JSON.stringify(plugin)};\nexport default [...xssSbyd.configs.lintMigration];\n`,
  );
  await writeFile(
    join(root, "page.tsx"),
    "export default function Page() { return <main />; }\n",
  );
  await linkPackage(root, "eslint");
  await linkPackage(root, "typescript");
  await linkPackage(root, "safevalues");
  await linkPackage(root, "eslint-plugin-next-xss-sbyd");
  await symlink(
    join(workspaceRoot, "packages/next-xss-sbyd"),
    join(root, "node_modules", "next-xss-sbyd"),
    "junction",
  );

  const initial = await rejectedReport([
    "packages/next-xss-sbyd/dist/cli.js",
    "audit",
    root,
    "--stage",
    "lint",
    "--recommended",
    "--fail-on-warning",
    "--json",
  ]);
  assert.equal(initial.code, 1);
  assert.deepEqual(initial.report.diagnostics.filter(({status}) => status === "warning").map(({id}) => id), ["audit.recommended-scope"]);
  assert.equal(initial.report.toolVersion, "0.0.0-milestone2");
  assert.equal(initial.report.presetVersion, "0.0.0-milestone3");
  await writeFile(join(root, "baseline.json"), JSON.stringify(initial.report));
  const compared = await rejectedReport([
    "packages/next-xss-sbyd/dist/cli.js",
    "audit",
    root,
    "--stage",
    "lint",
    "--recommended",
    "--baseline",
    "baseline.json",
    "--fail-on-warning",
    "--json",
  ]);
  assert.equal(compared.code, 1);
  assert.deepEqual(compared.report.diagnostics.filter(({status}) => status === "warning").map(({id}) => id), ["audit.recommended-scope"]);
  assert.equal(
    compared.report.diagnostics.some((item) => item.id === "baseline.pass"),
    true,
  );
  assert.equal(
    compared.report.diagnostics.some(
      (item) => item.id === "audit.recommended-scope",
    ),
    true,
  );
});

test("audit exposes bulk-suppressed xss-sbyd findings and inventories the exemption", async () => {
  const root = await mkdtemp(join(tmpdir(), "next-xss-sbyd-audit-"));
  const plugin = new URL(
    "../eslint-plugin-next-xss-sbyd/dist/index.js",
    import.meta.url,
  ).href;
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "fixture",
      type: "module",
      devDependencies: {typescript: "^5.9.2"},
      dependencies: { next: "16.3.4", react: "19.2.8" },
    }),
  );
  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { jsx: "preserve", jsxImportSource: "next-xss-sbyd" },
      include: ["**/*.tsx"],
    }),
  );
  await writeFile(
    join(root, "eslint.config.mjs"),
    `import xssSbyd from ${JSON.stringify(plugin)};\nexport default [...xssSbyd.configs.recommended];\n`,
  );
  await linkPackage(root, "eslint");
  await linkPackage(root, "typescript");
  await writeFile(
    join(root, "page.tsx"),
    'export default function Page() { return <main dangerouslySetInnerHTML={{__html: "unsafe"}} />; }\n',
  );
  await writeFile(
    join(root, "eslint-suppressions.json"),
    JSON.stringify({ "page.tsx": { "xss-sbyd/no-danger": { count: 2 } } }),
  );

  let report;
  try {
    await execFileAsync(process.execPath, [
      "packages/next-xss-sbyd/dist/cli.js",
      "audit",
      root,
      "--json",
    ]);
    assert.fail("audit should reject an unjustified bulk suppression");
  } catch (error) {
    report = JSON.parse(error.stdout);
  }
  assert.equal(
    report.exemptions.some(
      (item) => item.kind === "bulk" && item.ruleId === "xss-sbyd/no-danger",
    ),
    true,
  );
  assert.equal(
    report.findings.some(
      (item) => item.ruleId === "xss-sbyd/no-danger" && item.suppressed,
    ),
    true,
  );
  assert.equal(
    report.diagnostics.some((item) => item.id === "audit.reviewed-exemptions"),
    true,
  );
  assert.equal(
    report.diagnostics.some(
      (item) => item.id === "audit.exemption-unjustified",
    ),
    false,
  );
});

test("audit ignores colliding plugin rules and unrelated disable comments", async () => {
  const root = await mkdtemp(join(tmpdir(), "next-xss-sbyd-rule-owner-"));
  const plugin = new URL(
    "../eslint-plugin-next-xss-sbyd/dist/index.js",
    import.meta.url,
  ).href;
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "fixture", type: "module", devDependencies: {typescript: "^5.9.2"} }),
  );
  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { jsx: "preserve", jsxImportSource: "next-xss-sbyd" },
      include: ["**/*.tsx"],
    }),
  );
  await writeFile(
    join(root, "eslint.config.mjs"),
    [
      `import xssSbyd from ${JSON.stringify(plugin)};`,
      "const react = {meta: {name: 'eslint-plugin-react'}, rules: {'no-danger': {meta: {schema: []}, create(context) { return {Program(node) { context.report({node, message: 'collision'}); }}; }}}};",
      "export default [...xssSbyd.configs.lintMigration, {plugins: {react}, rules: {'react/no-danger': 'warn'}}];",
    ].join("\n"),
  );
  await writeFile(
    join(root, "page.tsx"),
    [
      "// eslint-disable-next-line react-hooks/exhaustive-deps",
      "export const value = 1;",
    ].join("\n"),
  );
  await linkPackage(root, "eslint");
  await linkPackage(root, "typescript");

  const result = await rejectedReport([
    "packages/next-xss-sbyd/dist/cli.js",
    "audit",
    root,
    "--stage",
    "lint",
    "--json",
  ]);
  assert.equal(
    result.report.findings.some((item) => item.ruleId === "react/no-danger"),
    false,
  );
  assert.equal(result.report.exemptions.length, 0);
  assert.equal(
    result.report.diagnostics.some(
      (item) => item.id === "audit.exemption-unjustified",
    ),
    false,
  );
});

test("audit inventories documented restricted imports without loading TypeScript", async () => {
  const root = await mkdtemp(join(tmpdir(), "next-xss-sbyd-restricted-"));
  const plugin = new URL(
    "../eslint-plugin-next-xss-sbyd/dist/index.js",
    import.meta.url,
  ).href;
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "fixture", type: "module", devDependencies: {typescript: "^5.9.2"} }),
  );
  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { jsx: "preserve", jsxImportSource: "next-xss-sbyd" },
      include: ["**/*.ts"],
    }),
  );
  await writeFile(
    join(root, "eslint.config.mjs"),
    `import xssSbyd from ${JSON.stringify(plugin)};\nexport default [...xssSbyd.configs.lintMigration];\n`,
  );
  await writeFile(
    join(root, "escape.ts"),
    [
      'import {htmlSafeByReview} from "safevalues/restricted/reviewed";',
      'export const loadReviewed = () => import("next-xss-sbyd/restricted");',
      "export {htmlSafeByReview};",
    ].join("\n"),
  );
  await linkPackage(root, "eslint");
  const result = await rejectedReport([
    "packages/next-xss-sbyd/dist/cli.js",
    "audit",
    root,
    "--stage",
    "lint",
    "--json",
    "--fail-on-warning",
  ]);
  assert.equal(result.code, 1);
  assert.deepEqual(result.report.diagnostics.filter(({status}) => status === "warning").map(({id}) => id), ["audit.reviewed-exemptions"]);
  assert.equal(Object.hasOwn(result.report, "styleFindings"), false);
  assert.equal(result.report.diagnostics.some((item) => item.id.startsWith("audit.style-")), false);
  assert.equal(
    result.report.exemptions.filter(
      (item) => item.kind === "restricted-import" && item.file === "escape.ts",
    ).length,
    2,
  );
  assert.equal(
    result.report.diagnostics.some(
      (item) => item.id === "audit.exemption-unjustified",
    ),
    false,
  );
});

test("safevalues resolution supports a hoisted workspace installation", async () => {
  const mono = await mkdtemp(join(tmpdir(), "next-xss-sbyd-hoisted-"));
  const app = join(mono, "apps", "web");
  await mkdir(app, { recursive: true });
  await linkPackage(mono, "safevalues");
  await writeFile(
    join(app, "package.json"),
    JSON.stringify({
      name: "web",
      dependencies: { next: "16.3.4", react: "19.2.8" },
    }),
  );
  await writeFile(join(app, "tsconfig.json"), "{}\n");
  const result = await rejectedReport([
    "packages/next-xss-sbyd/dist/cli.js",
    "check-config",
    app,
    "--stage",
    "lint",
    "--json",
  ]);
  assert.equal(
    result.report.diagnostics.some(
      (item) => item.id === "dependencies.safevalues-single",
    ),
    true,
  );
  assert.equal(
    result.report.diagnostics.some(
      (item) => item.id === "dependencies.safevalues-unresolved",
    ),
    false,
  );
});

test("CSP suggestion CLI aggregates JSON and JSON Lines while separating warnings", async () => {
  const root = await mkdtemp(join(tmpdir(), "next-xss-sbyd-csp-suggest-"));
  const arrayFile = join(root, "reports.json");
  await writeFile(
    arrayFile,
    JSON.stringify([
      {
        violatedDirective: "img-src",
        blockedOrigin: "https://images.example.test",
        sample: "",
      },
      {
        violatedDirective: "script-src",
        blockedOrigin: "inline",
        sample: "alert(1)",
      },
    ]),
  );
  const fromArray = await execFileAsync(process.execPath, [
    "packages/next-xss-sbyd/dist/csp-suggest.js",
    arrayFile,
  ]);
  assert.deepEqual(JSON.parse(fromArray.stdout), {
    imgSrc: ["'self'", "https://images.example.test"],
  });
  assert.match(fromArray.stderr, /do not add 'unsafe-inline'/u);

  const linesFile = join(root, "reports.jsonl");
  await writeFile(
    linesFile,
    [
      JSON.stringify({
        violatedDirective: "font-src",
        blockedOrigin: "https://fonts.example.test",
        sample: "",
      }),
      "",
      JSON.stringify({
        violatedDirective: "media-src",
        blockedOrigin: "data:",
        sample: "",
      }),
    ].join("\n"),
  );
  const fromLines = await execFileAsync(process.execPath, [
    "packages/next-xss-sbyd/dist/csp-suggest.js",
    linesFile,
  ]);
  assert.deepEqual(JSON.parse(fromLines.stdout), {
    fontSrc: ["'self'", "https://fonts.example.test"],
    mediaSrc: ["'self'", "data:"],
  });
});

test("CSP suggestion CLI rejects malformed input", async () => {
  const root = await mkdtemp(join(tmpdir(), "next-xss-sbyd-csp-invalid-"));
  const input = join(root, "reports.json");
  await writeFile(input, "not json");
  await assert.rejects(
    execFileAsync(process.execPath, [
      "packages/next-xss-sbyd/dist/csp-suggest.js",
      input,
    ]),
    (error) =>
      error.code === 1 &&
      /Expected a JSON array or one JSON object per line/u.test(error.stderr),
  );

  await writeFile(input, JSON.stringify({ violatedDirective: "img-src" }));
  await assert.rejects(
    execFileAsync(process.execPath, [
      "packages/next-xss-sbyd/dist/csp-suggest.js",
      input,
    ]),
    (error) =>
      error.code === 1 && /Invalid normalized CSP report/u.test(error.stderr),
  );

  await writeFile(
    input,
    JSON.stringify([
      {
        violatedDirective: "img-src",
        blockedOrigin: "https://images.example",
        sample: "",
      },
      { violatedDirective: "img-src" },
    ]),
  );
  await assert.rejects(
    execFileAsync(process.execPath, [
      "packages/next-xss-sbyd/dist/csp-suggest.js",
      input,
    ]),
    (error) =>
      error.code === 1 && /Invalid normalized CSP report/u.test(error.stderr),
  );
});
