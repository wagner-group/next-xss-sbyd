#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stderr as output } from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CommandReport, Diagnostic, Stage } from "./cli-types.js";
import { isStage } from "./cli-types.js";
import { discoverProject, relativePath, sourceFiles } from "./project.js";
import { checkConfiguration } from "./config-check.js";
import { runAudit } from "./audit.js";
import { applyEnable, planEnable } from "./enable-config.js";

const execFileAsync = promisify(execFile);

interface Arguments {
  command?: string;
  directory: string;
  stage?: Stage;
  json: boolean;
  failOnWarning: boolean;
  allowMigration: boolean;
  recommended: boolean;
  dryRun: boolean;
  noInstall: boolean;
  yes: boolean;
  force: boolean;
  sanitizeNode: boolean;
  maxWarnings?: number;
  baseline?: string;
}

const HELP = `next-xss-sbyd retrofit CLI

Usage:
  next-xss-sbyd enable-config [directory] --stage lint|runtime|recommended|csp-report|enforce [--dry-run] [--yes] [--no-install] [--sanitize-node] [--force]
  next-xss-sbyd check-config [directory] [--stage lint|runtime|recommended|csp-report|enforce] [--json] [--fail-on-warning]
  next-xss-sbyd audit [directory] [--allow-migration] [--recommended] [--baseline file] [--max-warnings N] [--json] [--fail-on-warning]

Stages are explicit and monotonic. lint changes static severity only: runtime integrations still throw once enabled.
check-config and audit never write, install, fix source, or update a baseline. Passing does not prove XSS freedom or deployment readiness.
`;

function parseArguments(argv: readonly string[]): Arguments {
  const result: Arguments = {
    command: argv[0],
    directory: ".",
    json: false,
    failOnWarning: false,
    allowMigration: false,
    recommended: false,
    dryRun: false,
    noInstall: false,
    yes: false,
    force: false,
    sanitizeNode: false,
  };
  let directorySet = false;
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json") result.json = true;
    else if (value === "--fail-on-warning") result.failOnWarning = true;
    else if (value === "--allow-migration") result.allowMigration = true;
    else if (value === "--recommended") result.recommended = true;
    else if (value === "--dry-run") result.dryRun = true;
    else if (value === "--no-install") result.noInstall = true;
    else if (value === "--yes") result.yes = true;
    else if (value === "--force") result.force = true;
    else if (value === "--sanitize-node") result.sanitizeNode = true;
    else if (value === "--stage") {
      const stage = argv[++index];
      if (!stage || !isStage(stage))
        throw new Error(
          "--stage requires lint, runtime, recommended, csp-report, or enforce",
        );
      result.stage = stage;
    } else if (value === "--max-warnings") {
      const count = Number(argv[++index]);
      if (!Number.isSafeInteger(count) || count < 0)
        throw new Error(`${value} requires a non-negative integer`);
      result.maxWarnings = count;
    } else if (value === "--baseline") {
      result.baseline = argv[++index];
      if (!result.baseline) throw new Error("--baseline requires a file");
    } else if (value.startsWith("-"))
      throw new Error(`Unknown option: ${value}`);
    else if (directorySet) throw new Error(`Unexpected argument: ${value}`);
    else {
      result.directory = value;
      directorySet = true;
    }
  }
  return result;
}

function textReport(report: CommandReport): string {
  const lines = [
    `next-xss-sbyd ${report.command}: stage ${report.stage}`,
    `Application: ${report.root}`,
  ];
  for (const diagnostic of report.diagnostics)
    lines.push(
      `[${diagnostic.status.toUpperCase()}] ${diagnostic.id}: ${diagnostic.message}` +
        `\n  Next: ${diagnostic.action}` +
        (diagnostic.evidence ? `\n  Evidence: ${diagnostic.evidence}` : ""),
    );
  for (const finding of report.findings ?? [])
    lines.push(
      `[${finding.suppressed ? "SUPPRESSED" : finding.severity === 2 ? "ERROR" : "WARNING"}] ` +
        `${finding.file}:${finding.line ?? 0}:${finding.column ?? 0} ${finding.ruleId} ` +
        `(${finding.scope}, ${finding.category}${finding.setup ? ", setup" : ""}): ${finding.message}`,
    );
  for (const exemption of report.exemptions ?? [])
    lines.push(
      `[EXEMPTION] ${exemption.file}:${exemption.line ?? 0} ${exemption.kind} ` +
        `${exemption.ruleId ?? ""}` +
        (exemption.justification
          ? ` — ${exemption.justification}`
          : " — missing justification"),
    );
  for (const change of report.changes ?? [])
    lines.push(
      `[${change.action.toUpperCase()}] ${change.file}: ${change.reason}${change.content ? `\n${change.content}` : ""}`,
    );
  return `${lines.join("\n")}\n`;
}

function exitCode(
  diagnostics: readonly Diagnostic[],
  failOnWarning: boolean,
): number {
  if (
    diagnostics.some((item) =>
      [
        "eslint.analysis-failed",
        "audit.failed",
        "enable.confirmation-required",
        "enable.declined",
      ].includes(item.id),
    )
  )
    return 2;
  if (diagnostics.some((item) => item.status === "error")) return 1;
  return failOnWarning && diagnostics.some((item) => item.status === "warning")
    ? 1
    : 0;
}

async function dirtyPlannedFiles(
  root: string,
  files: readonly string[],
): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["status", "--porcelain", "--", ...files],
      { cwd: root },
    );
    return stdout.trim() ? stdout.trim().split("\n") : [];
  } catch {
    return [];
  }
}

async function reportVersions(
  root: string,
): Promise<{ toolVersion: string; presetVersion: string }> {
  const packagePath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../package.json",
  );
  const own = JSON.parse(await readFile(packagePath, "utf8")) as {
    version: string;
  };
  let presetVersion = "unresolved";
  try {
    const requireFromApp = createRequire(resolve(root, "package.json"));
    const pluginEntry = requireFromApp.resolve("eslint-plugin-next-xss-sbyd");
    const pluginPackage = resolve(dirname(pluginEntry), "../package.json");
    const plugin = JSON.parse(await readFile(pluginPackage, "utf8")) as {
      version: string;
    };
    presetVersion = plugin.version;
  } catch {
    // Configuration diagnostics explain a missing application plugin.
  }
  return { toolVersion: own.version, presetVersion };
}

async function baselineDiagnostics(
  path: string,
  report: CommandReport,
): Promise<Diagnostic[]> {
  try {
    const baseline = JSON.parse(
      await readFile(resolve(report.root, path), "utf8"),
    ) as CommandReport;
    if (
      baseline.schemaVersion !== report.schemaVersion ||
      baseline.command !== "audit" ||
      baseline.toolVersion !== report.toolVersion ||
      baseline.presetVersion !== report.presetVersion
    )
      return [
        {
          id: "baseline.incompatible",
          category: "ratchet",
          status: "error",
          message:
            "Baseline schema, tool version, or preset version is incompatible.",
          action: "Generate and version a new reviewed baseline explicitly.",
        },
      ];
    const beforeFiles = new Set(baseline.fileScope ?? []);
    const afterFiles = new Set(report.fileScope ?? []);
    if (
      [...beforeFiles].some((file) => !afterFiles.has(file)) ||
      [...afterFiles].some((file) => !beforeFiles.has(file))
    )
      return [
        {
          id: "baseline.scope-changed",
          category: "ratchet",
          status: "error",
          message: "The audited file scope changed from the baseline.",
          action:
            "Review coverage changes and create a new baseline explicitly instead of presenting a direct progress comparison.",
        },
      ];
    const count = (items: CommandReport["findings"]): Map<string, number> => {
      const totals = new Map<string, number>();
      for (const item of items ?? []) {
        if (item.setup) continue;
        const key = `${item.scope}:${item.ruleId}`;
        totals.set(key, (totals.get(key) ?? 0) + 1);
      }
      return totals;
    };
    const before = count(baseline.findings);
    const after = count(report.findings);
    const grown = [...after].filter(
      ([rule, value]) => value > (before.get(rule) ?? 0),
    );
    if (grown.length > 0)
      return [
        {
          id: "baseline.growth",
          category: "ratchet",
          status: "error",
          message: `Finding growth: ${grown.map(([rule, value]) => `${rule} ${before.get(rule) ?? 0}->${value}`).join(", ")}.`,
          action:
            "Resolve added findings; growth in one rule cannot be offset by reductions elsewhere.",
        },
      ];
    return [
      {
        id: "baseline.pass",
        category: "ratchet",
        status: "pass",
        message: "No per-rule remediation finding count increased.",
        action:
          "Keep the baseline versioned and update it only through review.",
      },
    ];
  } catch (error) {
    return [
      {
        id: "baseline.failed",
        category: "ratchet",
        status: "error",
        message: `Baseline could not be read: ${String(error)}`,
        action: "Provide a compatible, versioned JSON audit file.",
      },
    ];
  }
}

async function main(): Promise<void> {
  let args: Arguments;
  try {
    args = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(String(error));
    console.error(HELP);
    process.exitCode = 2;
    return;
  }
  if (!args.command || args.command === "--help" || args.command === "help") {
    console.log(HELP);
    return;
  }
  if (!["enable-config", "check-config", "audit"].includes(args.command)) {
    console.error(`Unknown command: ${args.command}\n${HELP}`);
    process.exitCode = 2;
    return;
  }
  try {
    const project = await discoverProject(args.directory);
    const fileScope = (await sourceFiles(project.root)).map((file) =>
      relativePath(project, file),
    );
    const versions = await reportVersions(project.root);
    const reportBase = {
      schemaVersion: 1 as const,
      ...versions,
      root: project.root,
      fileScope,
    };
    const stage =
      args.stage ??
      project.recordedStage ??
      (args.command === "audit" && args.allowMigration ? "lint" : "enforce");
    let report: CommandReport;
    if (args.command === "check-config") {
      const diagnostics = await checkConfiguration(project, stage);
      report = {
        ...reportBase,
        command: "check-config",
        stage,
        complete: !diagnostics.some((item) => item.status === "error"),
        diagnostics,
      };
    } else if (args.command === "audit") {
      const checked = await checkConfiguration(project, stage);
      const audited = await runAudit(project, {
        recommended: args.recommended,
        maxWarnings: args.maxWarnings,
      });
      report = {
        ...reportBase,
        command: "audit",
        stage,
        complete: false,
        diagnostics: [...checked, ...audited.diagnostics],
        findings: audited.findings,
        exemptions: audited.exemptions,
      };
      if (args.baseline)
        report = {
          ...report,
          diagnostics: [
            ...report.diagnostics,
            ...(await baselineDiagnostics(args.baseline, report)),
          ],
        };
      report = {
        ...report,
        complete: !report.diagnostics.some((item) => item.status === "error"),
      };
    } else {
      if (!args.stage) throw new Error("enable-config requires --stage");
      const planned = await planEnable(project, stage, args);
      report = {
        ...reportBase,
        command: "enable-config",
        stage,
        complete: false,
        diagnostics: planned.diagnostics,
        changes: planned.changes,
      };
      const writable = planned.changes
        .filter((item) => item.action === "create" || item.action === "modify")
        .map((item) => item.file);
      if (!args.dryRun && !args.force && writable.length > 0) {
        const dirty = await dirtyPlannedFiles(project.root, writable);
        if (dirty.length > 0)
          report = {
            ...report,
            diagnostics: [
              ...report.diagnostics,
              {
                id: "enable.dirty-target",
                category: "write",
                status: "error",
                message: `Refusing to overwrite changed target files: ${dirty.join(", ")}`,
                action:
                  "Commit/stash those target files or rerun with --force after making them recoverable.",
              },
            ],
          };
      }
      const canApply =
        !args.dryRun &&
        !report.diagnostics.some((item) => item.status === "error");
      let confirmed = args.yes;
      let printed = false;
      if (canApply && !confirmed) {
        output.write(textReport(report));
        printed = true;
        if (!stdin.isTTY) {
          report = {
            ...report,
            diagnostics: [
              ...report.diagnostics,
              {
                id: "enable.confirmation-required",
                category: "write",
                status: "error",
                message:
                  "Interactive confirmation is unavailable on non-interactive stdin.",
                action:
                  "Rerun with --yes to apply changes or --dry-run to inspect them.",
              },
            ],
          };
        } else {
          const readline = createInterface({ input: stdin, output });
          confirmed =
            (await readline.question("Apply supported changes? [y/N] "))
              .trim()
              .toLowerCase() === "y";
          readline.close();
          if (!confirmed)
            report = {
              ...report,
              diagnostics: [
                ...report.diagnostics,
                {
                  id: "enable.declined",
                  category: "write",
                  status: "error",
                  message:
                    "No changes were applied because confirmation was declined.",
                  action:
                    "Rerun with --yes when ready, or use --dry-run to inspect the plan.",
                },
              ],
            };
        }
      }
      if (
        canApply &&
        confirmed &&
        !report.diagnostics.some((item) => item.status === "error")
      ) {
        await applyEnable(project, planned.changes, args);
      }
      report = {
        ...report,
        complete:
          canApply &&
          confirmed &&
          !planned.changes.some((item) => item.action === "manual"),
      };
      if (!args.json && printed) output.write(textReport(report));
    }
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else if (args.command !== "enable-config" || args.yes || args.dryRun)
      process.stdout.write(textReport(report));
    process.exitCode = exitCode(report.diagnostics, args.failOnWarning);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

await main();
