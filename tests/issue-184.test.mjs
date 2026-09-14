import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const cli = join(workspaceRoot, "packages/next-xss-sbyd/dist/cli.js");
const ruleId = "xss-sbyd/no-danger";
const unsafePage = 'export default function Page() { return <main dangerouslySetInnerHTML={{__html: "unsafe"}} />; }\n';

async function createApp(t, eslintPackage) {
  const temporaryRoot = join(workspaceRoot, "tmp");
  await mkdir(temporaryRoot, { recursive: true });
  const root = await mkdtemp(join(temporaryRoot, "issue-184-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "node_modules"));
  // Resolve the real engine through the application's own node_modules,
  // just as the CLI does in a project with a different ESLint version.
  await symlink(dirname(require.resolve(`${eslintPackage}/package.json`)), join(root, "node_modules/eslint"), "dir");
  const appRequire = createRequire(join(root, "package.json"));
  assert.equal(appRequire("eslint").ESLint.version, require(eslintPackage).ESLint.version);
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "issue-184-fixture",
    type: "module",
    dependencies: { next: "15.5.21", react: "19.1.0", "next-xss-sbyd": "0.0.0" },
  }));
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { jsx: "preserve", jsxImportSource: "next-xss-sbyd" },
    include: ["**/*.tsx"],
  }));
  await writeFile(join(root, "eslint.config.mjs"),
    'import xssSbyd from "eslint-plugin-next-xss-sbyd";\nexport default [...xssSbyd.configs.lintMigration];\n');
  await writeFile(join(root, "page.tsx"), 'export default function Page() { return <main />; }\n');
  return root;
}

async function auditOutput(root, ...options) {
  let result;
  try {
    result = { ...await execFileAsync(process.execPath, [
      cli, "audit", root, "--stage", "lint", ...options,
    ], { cwd: workspaceRoot }), code: 0 };
  } catch (error) {
    assert.equal(typeof error.code, "number", error.message);
    result = error;
  }
  return { status: result.code, stdout: result.stdout };
}

async function audit(root, ...options) {
  const { status, stdout } = await auditOutput(root, "--json", ...options);
  return { status, report: JSON.parse(stdout) };
}

function securityFindings(report) {
  return report.findings.filter((finding) => finding.ruleId === ruleId && finding.scope === "app-effective");
}

for (const eslintPackage of ["eslint9", "eslint"]) {
  const major = Number(require(eslintPackage).ESLint.version.split(".")[0]);

  test(`ESLint ${major}: CLI audit completes for a clean application`, async (t) => {
    const root = await createApp(t, eslintPackage);
    const { status, report } = await audit(root);
    assert.equal(status, 0, JSON.stringify(report));
    assert.equal(report.complete, true);
    assert.deepEqual(report.findings, []);
    assert.ok(!report.diagnostics.some((item) => item.id === "audit.bulk-suppressions-unapplied"));
    assert.ok(report.fileScope.includes("page.tsx"));
    const text = await auditOutput(root);
    assert.equal(text.status, 0);
    assert.ok(!text.stdout.includes("audit.bulk-suppressions-unapplied"));
  });

  test(`ESLint ${major}: CLI audit counts ordinary violations against the warning budget`, async (t) => {
    const root = await createApp(t, eslintPackage);
    await writeFile(join(root, "page.tsx"), unsafePage);
    const { status, report } = await audit(root, "--max-warnings", "0");
    assert.equal(status, 1, JSON.stringify(report));
    assert.equal(securityFindings(report).length, 2);
    assert.ok(securityFindings(report).every((finding) => !finding.suppressed));
    assert.ok(report.diagnostics.some((item) => item.id === "audit.warning-budget"));
  });

  for (const justification of ["", " -- reviewed static markup"]) {
    test(`ESLint ${major}: CLI audit inventories inline disables ${justification ? "with" : "without"} justification`, async (t) => {
      const root = await createApp(t, eslintPackage);
      await writeFile(join(root, "page.tsx"), `/* eslint-disable ${ruleId}${justification} */\n${unsafePage}`);
      const { status, report } = await audit(root, "--max-warnings", "0");
      assert.equal(status, justification ? 0 : 1, JSON.stringify(report));
      assert.equal(securityFindings(report).length, 2);
      assert.ok(securityFindings(report).every((finding) => finding.suppressed));
      const exemptions = report.exemptions.filter((item) => item.kind === "inline" && item.ruleId === ruleId);
      assert.equal(exemptions.length, 2);
      assert.equal(exemptions[0].justification, justification ? "reviewed static markup" : undefined);
      assert.equal(report.diagnostics.some((item) => item.id === "audit.exemption-unjustified"), !justification);
    });
  }

  for (const [location, severity] of [
    ["eslint-suppressions.json", 1],
    ["eslint-suppressions.json", 2],
    ["custom-suppressions.json", 1],
    ["custom-suppressions.json", 2],
  ]) {
    test(`ESLint ${major}: CLI audit exposes severity ${severity} bulk findings from ${location}`, async (t) => {
      const root = await createApp(t, eslintPackage);
      if (severity === 2) {
        await writeFile(join(root, "eslint.config.mjs"),
          'import xssSbyd from "eslint-plugin-next-xss-sbyd";\nexport default [...xssSbyd.configs.recommended];\n');
      }
      if (location !== "eslint-suppressions.json") {
        await writeFile(join(root, "package.json"), JSON.stringify({
          name: "issue-184-fixture", type: "module",
          dependencies: { next: "15.5.21", react: "19.1.0", "next-xss-sbyd": "0.0.0" },
          scripts: { lint: `eslint . --suppressions-location ${location}` },
        }));
      }
      await writeFile(join(root, "page.tsx"), unsafePage);
      await writeFile(join(root, location), JSON.stringify({ "page.tsx": { [ruleId]: { count: 2 } } }));
      const { status, report } = await audit(root, "--stage", severity === 2 ? "enforce" : "lint", "--max-warnings", "0");
      // ESLint 10 applies bulk suppressions only to errors. ESLint 9's API
      // leaves both severities unsuppressed. Enforce-stage fixtures also
      // report missing runtime/CSP setup, independently of these findings.
      assert.equal(status, 1, JSON.stringify(report));
      assert.equal(report.diagnostics.some((item) => item.id === "audit.failed"), false);
      assert.equal(securityFindings(report).length, 2);
      assert.ok(securityFindings(report).every((finding) => finding.severity === severity && finding.suppressed === (major >= 10 && severity === 2)));
      assert.ok(report.exemptions.some((item) => item.kind === "bulk" && item.file === "page.tsx" && item.ruleId === ruleId));
      assert.ok(report.diagnostics.some((item) => item.id === "audit.reviewed-exemptions"));
      const unapplied = report.diagnostics.filter((item) => item.id === "audit.bulk-suppressions-unapplied");
      assert.equal(unapplied.length, major === 9 ? 1 : 0);
      const text = await auditOutput(root, "--stage", severity === 2 ? "enforce" : "lint", "--max-warnings", "0");
      assert.equal(text.status, status);
      if (major === 9) {
        assert.equal(unapplied[0].status, "warning");
        assert.equal(unapplied[0].category, "exemptions");
        assert.ok(unapplied[0].message.includes(`ESLint ${require(eslintPackage).ESLint.version}`));
        assert.match(unapplied[0].message, /cannot apply.*programming interface/u);
        assert.match(unapplied[0].message, /remain active.*fail the audit.*ESLint directly passes/u);
        assert.match(unapplied[0].action, /Fix the findings.*compatible ESLint 10/u);
        assert.match(unapplied[0].action, /error-severity/u);
        assert.match(unapplied[0].action, /Warning-severity findings remain active/u);
        assert.ok(text.stdout.includes(`[WARNING] audit.bulk-suppressions-unapplied: ${unapplied[0].message}`));
        assert.ok(text.stdout.includes(unapplied[0].action));
      } else {
        assert.ok(!text.stdout.includes("audit.bulk-suppressions-unapplied"));
      }
      assert.equal(report.diagnostics.some((item) => item.id === "audit.warning-budget"), severity === 1);
      assert.equal(report.diagnostics.some((item) => item.id === "audit.finding-errors"), major === 9 && severity === 2);
      if (severity === 1) {
        const allowed = await audit(root, "--max-warnings", "2");
        assert.equal(allowed.status, 0, JSON.stringify(allowed.report));
        assert.deepEqual(securityFindings(allowed.report), securityFindings(report));
        assert.ok(!allowed.report.diagnostics.some((item) => item.id === "audit.warning-budget"));
      }
    });
  }

  for (const location of ["eslint-suppressions.json", "custom-suppressions.json"]) {
    for (const condition of ["malformed", "unreadable"]) {
      test(`ESLint ${major}: CLI audit diagnoses ${condition} ${location}`, async (t) => {
        const root = await createApp(t, eslintPackage);
        if (location !== "eslint-suppressions.json") {
          await writeFile(join(root, "package.json"), JSON.stringify({
            name: "issue-184-fixture", type: "module",
            dependencies: { next: "15.5.21", react: "19.1.0", "next-xss-sbyd": "0.0.0" },
            scripts: { lint: `eslint . --suppressions-location ${location}` },
          }));
        }
        if (condition === "malformed") {
          await writeFile(join(root, location), "{not json");
        } else {
          // A real directory produces a read error without permission-dependent
          // chmod behavior (which would not reproduce when running as root).
          await mkdir(join(root, location));
        }
        const { status, report } = await audit(root, "--max-warnings", "0");
        // ESLint 9 and 10 resolve a directory to a cwd-hashed suppressions file inside it.
        // That file is absent in this empty directory, so there is nothing to inventory.
        const analysisFails = major >= 10 && condition === "malformed";
        assert.equal(status, analysisFails ? 2 : 0, JSON.stringify(report));
        assert.equal(report.complete, !analysisFails);
        assert.deepEqual(report.exemptions, []);
        assert.deepEqual(report.findings, []);
        assert.ok(!report.diagnostics.some((item) => item.id === "audit.bulk-suppressions-unapplied"));
        assert.ok(!report.diagnostics.some((item) => item.id === "audit.reviewed-exemptions"));
        const diagnostic = report.diagnostics.find((item) => item.id === (analysisFails
          ? "audit.failed" : "audit.bulk-suppressions-unreadable"));
        const emptyDirectory = condition === "unreadable";
        assert.equal(diagnostic !== undefined, !emptyDirectory);
        if (!analysisFails && !emptyDirectory) {
          assert.equal(diagnostic.status, "warning");
          assert.equal(diagnostic.category, "exemptions");
          assert.ok(diagnostic.message.includes(location));
          assert.deepEqual(diagnostic.location, { file: location });
          assert.match(diagnostic.evidence, condition === "malformed" ? /SyntaxError/u : /EISDIR/u);
          assert.match(diagnostic.action, /repair/iu);
          assert.match(diagnostic.action, /readable.*valid JSON/u);
        } else if (analysisFails) {
          assert.match(diagnostic.message, /Failed to parse suppressions file/u);
        }
        const text = await auditOutput(root, "--max-warnings", "0");
        assert.equal(text.status, status);
        if (diagnostic) {
          assert.ok(text.stdout.includes(diagnostic.message));
          assert.ok(text.stdout.includes(diagnostic.action));
        } else {
          assert.ok(!text.stdout.includes("audit.bulk-suppressions-unreadable"));
        }
        assert.ok(!text.stdout.includes("audit.bulk-suppressions-unapplied"));
        assert.doesNotMatch(text.stdout, /upgrade/iu);
        assert.doesNotMatch(JSON.stringify(report), /upgrade/iu);

        if (!analysisFails) {
          await writeFile(join(root, "page.tsx"), unsafePage);
          const violations = await audit(root, "--max-warnings", "0");
          assert.equal(violations.status, 1, JSON.stringify(violations.report));
          assert.equal(securityFindings(violations.report).length, 2);
          assert.ok(securityFindings(violations.report).every((finding) => finding.severity === 1 && !finding.suppressed));
          assert.ok(violations.report.diagnostics.some((item) => item.id === "audit.warning-budget"));
          const allowed = await audit(root, "--max-warnings", "2");
          assert.equal(allowed.status, 0, JSON.stringify(allowed.report));
          assert.deepEqual(securityFindings(allowed.report), securityFindings(violations.report));
        }
      });
    }
  }

  for (const entries of [{}, { "page.tsx": { "no-console": { count: 1 } } }]) {
    test(`ESLint ${major}: CLI audit ignores irrelevant bulk entries ${JSON.stringify(entries)}`, async (t) => {
      const root = await createApp(t, eslintPackage);
      await writeFile(join(root, "eslint-suppressions.json"), JSON.stringify(entries));
      const { status, report } = await audit(root, "--max-warnings", "0");
      assert.equal(status, 0, JSON.stringify(report));
      assert.ok(!report.exemptions.some((item) => item.kind === "bulk"));
      assert.ok(!report.diagnostics.some((item) => item.id === "audit.bulk-suppressions-unapplied"));
      const text = await auditOutput(root);
      assert.equal(text.status, 0);
      assert.ok(!text.stdout.includes("audit.bulk-suppressions-unapplied"));
    });
  }

  test(`ESLint ${major}: CLI audit's second pass exposes disabled restricted imports`, async (t) => {
    const root = await createApp(t, eslintPackage);
    await writeFile(join(root, "page.tsx"),
      '/* eslint-disable no-restricted-imports -- reviewed import */\nimport {htmlEscape} from "safevalues";\nexport default function Page() { return <main />; }\n');
    const { status, report } = await audit(root);
    assert.equal(status, 0, JSON.stringify(report));
    assert.ok(report.exemptions.some((item) => item.kind === "restricted-import" && item.file === "page.tsx"));
  });

  test(`ESLint ${major}: CLI audit rejects invalid ESLint configuration`, async (t) => {
    const root = await createApp(t, eslintPackage);
    await writeFile(join(root, "eslint.config.mjs"), 'export default [{ rules: { "no-such-rule": "error" } }];\n');
    const { status, report } = await audit(root);
    assert.equal(status, 2, JSON.stringify(report));
    assert.equal(report.complete, false);
    const failure = report.diagnostics.find((item) => item.id === "audit.failed");
    assert.ok(failure);
    assert.match(failure.message, /no-such-rule/u);
    assert.doesNotMatch(failure.message, /Invalid Options/u);
  });
}

// The resolver-failure diagnostic protects against a future ESLint internal API
// change. Installed ESLint 9/10 expose this helper; making it fail would require
// modifying the dependency or a test double, so it is not forced in these tests.
for (const eslintPackage of ["eslint9", "eslint"]) {
  const major = Number(require(eslintPackage).ESLint.version.split(".")[0]);
  for (const location of ["sup/", "sup", "eslint-suppressions.json", "missing/"]) {
    test(`ESLint ${major}: CLI audit resolves directory suppressions at ${location}`, async (t) => {
      const root = await createApp(t, eslintPackage);
      await writeFile(join(root, "eslint.config.mjs"),
        'import xssSbyd from "eslint-plugin-next-xss-sbyd";\nexport default [...xssSbyd.configs.recommended];\n');
      await writeFile(join(root, "page.tsx"), unsafePage);
      await writeFile(join(root, "package.json"), JSON.stringify({
        name: "issue-223-fixture", type: "module",
        dependencies: { next: "15.5.21", react: "19.1.0", "next-xss-sbyd": "0.0.0" },
        scripts: { lint: `eslint . --suppressions-location ${location}` },
      }));
      if (location === "missing/") {
        const absent = await audit(root);
        assert.ok(!absent.report.diagnostics.some((item) => item.id === "audit.bulk-suppressions-unreadable"));
        assert.deepEqual(absent.report.exemptions, []);
        assert.ok(securityFindings(absent.report).every((finding) => !finding.suppressed));
      }
      await mkdir(join(root, location));
      const eslintCli = join(dirname(require.resolve(`${eslintPackage}/package.json`)), "bin/eslint.js");
      await execFileAsync(process.execPath, [eslintCli, "page.tsx", "--suppress-all", "--suppressions-location", location], { cwd: root });
      const { report } = await audit(root);
      assert.ok(!report.diagnostics.some((item) => item.id === "audit.failed"), JSON.stringify(report));
      assert.equal(securityFindings(report).length, 2);
      assert.ok(securityFindings(report).every((finding) => finding.suppressed === (major >= 10)));
      assert.equal(report.diagnostics.some((item) => item.id === "audit.bulk-suppressions-unapplied"), major === 9);
      assert.deepEqual(report.exemptions.filter((item) => item.kind === "bulk"), [
        { kind: "bulk", file: "page.tsx", ruleId },
      ]);
      assert.ok(report.diagnostics.some((item) => item.id === "audit.reviewed-exemptions"));
      assert.ok(!report.diagnostics.some((item) => item.id === "audit.bulk-suppressions-unreadable"));
      const text = await auditOutput(root);
      assert.match(text.stdout, /audit.reviewed-exemptions/u);
      assert.equal(text.stdout.includes("[SUPPRESSED]"), major >= 10);
      if (location === "sup/") {
        const [filename] = await readdir(join(root, location));
        assert.match(filename, /^suppressions_/u);
        await writeFile(join(root, location, filename), "{not json");
        const corrupt = await audit(root);
        assert.equal(corrupt.status, major >= 10 ? 2 : 1);
        const diagnostic = corrupt.report.diagnostics.find((item) => item.id === (major >= 10
          ? "audit.failed" : "audit.bulk-suppressions-unreadable"));
        assert.ok(diagnostic, JSON.stringify(corrupt.report));
        assert.ok(diagnostic.message.includes(filename));
        if (major === 9) {
          assert.deepEqual(diagnostic.location, {file: `sup/${filename}`});
          assert.doesNotMatch(diagnostic.action, /select ESLint/u);
        }
      }
    });
  }
}
