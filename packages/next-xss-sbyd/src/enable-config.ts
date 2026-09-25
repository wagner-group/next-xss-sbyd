import { execFile } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { Diagnostic, PlannedChange, Stage } from "./cli-types.js";
import { stageIndex } from "./cli-types.js";
import type { Project } from "./project.js";
import { integrationBasename, managerInstallCommand } from "./project.js";
import { runAudit } from "./audit.js";
import { checkCsp, checkLint, checkRuntime } from "./config-check.js";

const execFileAsync = promisify(execFile);

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function packageText(project: Project, stage: Stage): string {
  const value = JSON.parse(project.packageJsonText) as Record<string, unknown>;
  value["next-xss-sbyd"] = { stage };
  return `${JSON.stringify(value, null, 2)}\n`;
}

function instrumentationText(): string {
  return [
    "export async function register() {",
    '  if (process.env.NEXT_RUNTIME === "nodejs") {',
    '    (await import("next-xss-sbyd/enforce")).installResponseGuard();',
    "  }",
    "}",
    "",
  ].join("\n");
}

function eslintText(stage: Stage): string {
  const preset =
    stage === "lint" || stage === "runtime" ? "lintMigration" : "recommended";
  return `import xssSbyd from "eslint-plugin-next-xss-sbyd";\n\nexport default [...xssSbyd.configs.${preset}];\n`;
}

function installPackages(project: Project): {
  runtime: string[];
  development: string[];
} {
  const dependencies = project.packageJson.dependencies ?? {};
  const devDependencies = project.packageJson.devDependencies ?? {};
  const installed = { ...dependencies, ...devDependencies };
  return {
    runtime: installed["next-xss-sbyd"] ? [] : ["next-xss-sbyd"],
    development: [
      "eslint-plugin-next-xss-sbyd",
      "@typescript-eslint/parser",
      "typescript",
      "eslint",
    ].filter((name) => !installed[name]),
  };
}

export interface EnableOptions {
  readonly dryRun: boolean;
  readonly noInstall: boolean;
  readonly yes: boolean;
  readonly force: boolean;
  readonly sanitizeNode: boolean;
}

async function runtimeResolvesSpread(
  project: Project,
  finding: import("./cli-types.js").AuditFinding,
): Promise<boolean> {
  if (!finding.ruleId.endsWith("/no-danger")) return false;
  if (finding.nodeType === "JSXSpreadAttribute") return true;
  if (!finding.line || !finding.column) return false;
  try {
    const line =
      (await readFile(resolve(project.root, finding.file), "utf8")).split("\n")[
        finding.line - 1
      ] ?? "";
    return /^\{\s*\.\.\./u.test(line.slice(finding.column - 1));
  } catch {
    return false;
  }
}

/** Plans conservative stage advancement, editing only owned files and JSON configuration. */
export async function planEnable(
  project: Project,
  stage: Stage,
  options: EnableOptions,
): Promise<{ changes: PlannedChange[]; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const changes: PlannedChange[] = [];
  if (
    project.recordedStage &&
    stageIndex(stage) < stageIndex(project.recordedStage)
  )
    return {
      changes,
      diagnostics: [
        {
          id: "enable.downgrade",
          category: "stage",
          status: "error",
          message: `Refusing to downgrade recorded stage ${project.recordedStage} to ${stage}.`,
          action: "Select the recorded or a later stage.",
        },
      ],
    };
  const packages = installPackages(project);
  // The legacy --sanitize-node flag needs no extra install: the package now
  // declares its sanitizer dependencies directly.
  if (packages.runtime.length > 0) {
    const install = managerInstallCommand(project, packages.runtime, false);
    changes.push({
      file: "package.json/lockfile",
      action: options.noInstall ? "manual" : "install",
      reason: [install.command, ...install.args].join(" "),
      ...(!options.noInstall ? install : {}),
    });
  }
  if (packages.development.length > 0) {
    const install = managerInstallCommand(project, packages.development, true);
    changes.push({
      file: "package.json/lockfile",
      action: options.noInstall ? "manual" : "install",
      reason: [install.command, ...install.args].join(" "),
      ...(!options.noInstall ? install : {}),
    });
  }
  if (!project.eslintConfig)
    changes.push({
      file: "eslint.config.mjs",
      action: "create",
      reason: `Enable the ${stage === "lint" || stage === "runtime" ? "lintMigration" : "recommended"} preset.`,
      content: eslintText(stage),
    });
  else {
    const lintDiagnostics = await checkLint(project, stage);
    if (lintDiagnostics.some((item) => item.status === "error"))
      changes.push({
        file: project.eslintConfig,
        action: "manual",
        reason:
          `Scope xssSbyd.configs.${stage === "lint" || stage === "runtime" ? "lintMigration" : "recommended"} ` +
          "to this app and ensure later overrides do not weaken it.",
      });
  }
  if (stageIndex(stage) >= stageIndex("runtime")) {
    const audit = await runAudit(project, { recommended: false });
    if (packages.development.length === 0)
      diagnostics.push(...audit.diagnostics.filter((item) => item.status === "error"));
    const resolved = await Promise.all(
      audit.findings.map((finding) => runtimeResolvesSpread(project, finding)),
    );
    const blockers = audit.findings.filter(
      (finding, index) =>
        !finding.suppressed && !finding.setup && !resolved[index],
    );
    if (blockers.length > 0)
      diagnostics.push({
        id: "enable.runtime-preflight",
        category: "findings",
        status: "error",
        message: `${blockers.length} source finding(s) remain after excluding runtime-resolved setup and JSX spread findings.`,
        action:
          "Remediate or review findings before automatic runtime activation.",
      });
    if (project.tsconfig) {
      try {
        const text = await readFile(
          resolve(project.root, project.tsconfig),
          "utf8",
        );
        const value = JSON.parse(text) as {
          compilerOptions?: Record<string, unknown>;
        };
        const current = value.compilerOptions?.jsxImportSource;
        if (current && current !== "next-xss-sbyd")
          diagnostics.push({
            id: "enable.jsx-conflict",
            category: "runtime",
            status: "error",
            message: `jsxImportSource is already ${String(current)}.`,
            action:
              "Resolve the custom JSX-runtime conflict manually; it will not be overwritten.",
          });
        else if (current !== "next-xss-sbyd") {
          value.compilerOptions ??= {};
          value.compilerOptions.jsxImportSource = "next-xss-sbyd";
          changes.push({
            file: project.tsconfig,
            action: "modify",
            reason: "Select the validating JSX runtime.",
            content: `${JSON.stringify(value, null, 2)}\n`,
          });
        }
      } catch {
        changes.push({
          file: project.tsconfig,
          action: "manual",
          reason:
            "tsconfig contains JSONC or dynamic inheritance; set the effective compilerOptions.jsxImportSource to next-xss-sbyd without changing sibling projects.",
        });
      }
    }
    const runtimeDiagnostics = await checkRuntime(project);
    if (
      runtimeDiagnostics.some((item) => item.id === "runtime.response-guard")
    ) {
      const instrumentation = integrationBasename(
        project,
        `${project.sourceRoot === "src" ? "src/" : ""}instrumentation`,
      );
      if (!(await exists(resolve(project.root, instrumentation))))
        changes.push({
          file: instrumentation,
          action: "create",
          reason: "Install the response guard only in the Node runtime.",
          content: instrumentationText(),
        });
    }
    if (runtimeDiagnostics.some((item) => item.id.startsWith("runtime.alias.")))
      changes.push({
        file: project.nextConfig ?? "next.config.*",
        action: "manual",
        reason:
          "Configure all next/link, next/image, and next/form aliases in both Turbopack and webpack. " +
          "Wrap the Next config with withXssSbyd from next-xss-sbyd/next-config to redirect bundled React JSX runtime imports. " +
          "Use webpack (Next 16: next dev --webpack and next build --webpack); Turbopack requires the explicit redirectJsxRuntime: false opt-out.",
      });
    diagnostics.push(...runtimeDiagnostics.filter((item) =>
      item.status === "error" && item.id !== "runtime.response-guard" && !item.id.startsWith("runtime.alias.") &&
      !(item.id === "runtime.jsx-import-source" && changes.some((change) => change.file === project.tsconfig && change.action === "modify"))));
  }
  if (stageIndex(stage) >= stageIndex("csp-report")) {
    const cspDiagnostics = await checkCsp(project, stage);
    if (cspDiagnostics.some((item) => item.status === "error"))
      changes.push({
        file: integrationBasename(
          project,
          `${project.sourceRoot === "src" ? "src/" : ""}${project.nextMajor === 16 ? "proxy" : "middleware"}`,
        ),
        action: "manual",
        reason:
          `${stage === "csp-report" ? "Configure report-only" : "Enforce"} CSP with an application-selected ` +
          "report endpoint and matcher; compose withXssSbydHeaders outermost.",
      });
  }
  if (
    project.recordedStage !== stage &&
    !changes.some((change) => change.action === "manual") &&
    !diagnostics.some((item) => item.status === "error")
  ) {
    changes.push({
      file: "package.json",
      action: "modify",
      reason: `Persist monotonic rollout stage ${stage}.`,
      content: packageText(project, stage),
    });
  } else if (project.recordedStage !== stage) {
    diagnostics.push({
      id: "enable.partial",
      category: "write",
      status: "warning",
      message:
        "The stage marker will not advance while manual changes or prerequisites remain.",
      action:
        "Apply the listed manual patches, rerun enable-config, and pass check-config before recording the stage.",
    });
  }
  return { changes, diagnostics };
}

/** Applies the supported portion of a previously displayed plan. */
export async function applyEnable(
  project: Project,
  changes: readonly PlannedChange[],
  options: EnableOptions,
): Promise<void> {
  const ordered = [...changes].sort(
    (left, right) =>
      Number(left.action === "install") - Number(right.action === "install"),
  );
  for (const change of ordered) {
    if (change.action === "manual") continue;
    if (change.action === "install") {
      if (options.noInstall) continue;
      if (!change.command || !change.args)
        throw new Error("Install plan is missing command data.");
      await execFileAsync(change.command, [...change.args], {
        cwd: project.root,
      });
    } else if (change.content !== undefined) {
      await writeFile(resolve(project.root, change.file), change.content, {
        flag: change.action === "create" ? "wx" : "w",
      });
    }
  }
}
