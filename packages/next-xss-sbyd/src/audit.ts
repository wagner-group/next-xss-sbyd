import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ESLint as ESLintType } from "eslint";
import type { AuditFinding, Diagnostic, Exemption } from "./cli-types.js";
import type { Project } from "./project.js";
import { relativePath, sourceFiles } from "./project.js";
import { inventoryResponses } from "./inventory.js";

const RULE_CATEGORIES: Readonly<Record<string, string>> = {
  "no-danger": "raw-html",
  "no-object-url": "object-url",
  "safe-jsx-urls-active": "active-url",
  "no-unsafe-html-response": "html-response",
  "no-unsafe-api-send": "node-send",
  "require-safe-api-route": "api-route-setup",
  "no-raw-render-to-string": "renderer",
  "no-dynamic-script-style": "inline-script-style",
  "no-html-content-type": "content-type",
  "no-unsafe-cast-to-safe-type": "unsafe-cast",
  "no-html-template-strings": "html-template",
  "require-safe-jsx-runtime": "runtime-setup",
  "require-disable-justification": "invalid-disable",
};

type LintResult = ESLintType.LintResult;

function requireFromApp(project: Project): NodeJS.Require {
  return createRequire(resolve(project.root, "package.json"));
}

async function eslintForProject(project: Project): Promise<typeof ESLintType> {
  const location = requireFromApp(project).resolve("eslint");
  const module = (await import(
    pathToFileURL(location).href
  )) as typeof import("eslint");
  return module.ESLint;
}

function isXssSbydRule(
  ruleId: string | null,
  aliases: ReadonlySet<string>,
): boolean {
  if (ruleId === null) return false;
  const separator = ruleId.lastIndexOf("/");
  if (separator < 1) return false;
  const alias = ruleId.slice(0, separator);
  const rule = ruleId.slice(separator + 1);
  return aliases.has(alias) && Object.hasOwn(RULE_CATEGORIES, rule);
}

function findings(
  results: readonly LintResult[],
  aliases: ReadonlySet<string>,
  scope: AuditFinding["scope"],
): AuditFinding[] {
  return results.flatMap((result) =>
    [
      ...result.messages.map((message) => ({ message, isSuppressed: false })),
      ...result.suppressedMessages.map((message) => ({
        message,
        isSuppressed: true,
      })),
    ]
      .filter(({ message }) => isXssSbydRule(message.ruleId, aliases))
      .map(({ message, isSuppressed }) => {
        const detail = message as typeof message & {
          nodeType?: string;
          suppressions?: unknown;
        };
        const ruleName = message.ruleId!.slice(
          message.ruleId!.lastIndexOf("/") + 1,
        );
        return {
          file: result.filePath,
          line: message.line,
          column: message.column,
          ruleId: message.ruleId!,
          ...(message.messageId ? { messageId: message.messageId } : {}),
          message: message.message,
          severity: message.severity as 1 | 2,
          category: RULE_CATEGORIES[ruleName] ?? ruleName,
          setup:
            ruleName === "require-safe-jsx-runtime" &&
            message.messageId === "config",
          suppressed: isSuppressed || detail.suppressions !== undefined,
          ...(detail.nodeType ? { nodeType: detail.nodeType } : {}),
          scope,
        };
      }),
  );
}

function analysisFailures(project: Project, results: readonly LintResult[]): string[] {
  return results.flatMap((result) => relativePath(project, result.filePath) === project.eslintConfig ? [] : result.messages
    .filter((message) => message.fatal === true && /parsing error|parser|project service/iu.test(message.message))
    .map((message) => `${result.filePath}:${message.line}:${message.column}: ${message.message}`));
}

function normalizePaths(
  project: Project,
  values: readonly AuditFinding[],
): AuditFinding[] {
  return values
    .map((item) => ({ ...item, file: relativePath(project, item.file) }))
    .sort(
      (left, right) =>
        left.file.localeCompare(right.file) ||
        (left.line ?? 0) - (right.line ?? 0) ||
        left.ruleId.localeCompare(right.ruleId),
    );
}

async function locateSuppressions(project: Project): Promise<string> {
  for (const script of Object.values(project.packageJson.scripts ?? {})) {
    const match = /--suppressions-location(?:=|\s+)([^\s]+)/u.exec(script);
    if (match) return match[1].replace(/^['"]|['"]$/gu, "");
  }
  return "eslint-suppressions.json";
}

function bulkEntries(
  value: unknown,
  aliases: ReadonlySet<string>,
): Exemption[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const entries: Exemption[] = [];
  for (const [file, rules] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (!rules || typeof rules !== "object" || Array.isArray(rules)) continue;
    for (const ruleId of Object.keys(rules as Record<string, unknown>)) {
      if (isXssSbydRule(ruleId, aliases))
        entries.push({ kind: "bulk", file, ruleId });
    }
  }
  return entries;
}

function restrictedImports(
  project: Project,
  results: readonly LintResult[],
): Exemption[] {
  return results.flatMap((result) =>
    result.messages
      .filter(
        (message) =>
          [
            "no-restricted-imports",
            "no-restricted-modules",
            "no-restricted-syntax",
          ].includes(message.ruleId ?? "") &&
          /(?:safevalues|next-xss-sbyd\/restricted)/u.test(message.message),
      )
      .map((message) => ({
        kind: "restricted-import" as const,
        file: relativePath(project, result.filePath),
        line: message.line,
        column: message.column,
      })),
  );
}

async function exemptionInventory(
  project: Project,
  ordinary: readonly LintResult[],
  exposed: readonly LintResult[],
  aliases: ReadonlySet<string>,
): Promise<{ exemptions: Exemption[]; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const exemptions: Exemption[] = ordinary.flatMap((result) =>
    result.suppressedMessages
      .filter(
        (message) =>
          isXssSbydRule(message.ruleId, aliases) &&
          message.suppressions?.some((item) => item.kind === "directive") ===
            true,
      )
      .map((message) => ({
        kind: "inline" as const,
        file: relativePath(project, result.filePath),
        line: message.line,
        column: message.column,
        ruleId: message.ruleId ?? undefined,
        justification:
          message.suppressions
            ?.filter((item) => item.kind === "directive")
            ?.map((item) => item.justification)
            .filter(Boolean)
            .join("; ") || undefined,
      })),
  );
  exemptions.push(...restrictedImports(project, exposed));
  const location = await locateSuppressions(project);
  let file: string | undefined;
  try {
    // ESLint 9 and 10 use this resolver independently of whether their API
    // applies suppressions. This assumes lint runs from project.root; a script
    // that changes cwd hashes a different directory. Preserve trailing slashes.
    const appRequire = requireFromApp(project);
    const eslintRoot = dirname(appRequire.resolve("eslint/package.json"));
    const { getCacheFile } = appRequire(
      resolve(eslintRoot, "lib/eslint/eslint-helpers.js"),
    ) as { getCacheFile(location: string, cwd: string, options: { prefix: string }): string };
    file = getCacheFile(location, project.root, { prefix: "suppressions_" });
  } catch (error) {
    diagnostics.push({
      id: "audit.bulk-suppressions-resolution-failed",
      category: "exemptions",
      status: "warning",
      message: `The audit could not resolve the bulk suppressions location ${location} using the installed ESLint's internal resolver; its entries could not be inventoried.`,
      action: "Check the installed ESLint version and report this resolver compatibility error to next-xss-sbyd; this does not mean the suppressions JSON is invalid.",
      location: { file: location },
      evidence: String(error),
    });
  }
  if (file !== undefined) {
    try {
      const value = JSON.parse(await readFile(file, "utf8"));
      exemptions.push(...bulkEntries(value, aliases));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        diagnostics.push({
          id: "audit.bulk-suppressions-unreadable",
          category: "exemptions",
          status: "warning",
          message: `The audit could not read or parse the bulk suppressions file ${relativePath(project, file)}; its entries could not be inventoried.`,
          action: "Ensure the resolved file is readable and contains valid JSON; repair the file, then rerun the audit.",
          location: { file: relativePath(project, file) },
          evidence: String(error),
        });
      }
    }
  }
  return {
    exemptions: exemptions.sort(
      (left, right) =>
        left.file.localeCompare(right.file) ||
        (left.line ?? 0) - (right.line ?? 0),
    ),
    diagnostics,
  };
}

async function aliasesAndIgnored(
  engine: ESLintType,
  files: readonly string[],
): Promise<{ aliases: Set<string>; ignored: string[] }> {
  const aliases = new Set<string>();
  const ignored: string[] = [];
  for (const file of files) {
    if (await engine.isPathIgnored(file)) {
      ignored.push(file);
      continue;
    }
    const config = await engine.calculateConfigForFile(file);
    const plugins = (config?.plugins ?? {}) as Record<
      string,
      { meta?: { name?: string } }
    >;
    for (const [alias, plugin] of Object.entries(plugins)) {
      if (plugin.meta?.name === "eslint-plugin-next-xss-sbyd")
        aliases.add(alias);
    }
  }
  return { aliases, ignored };
}

export interface AuditOptions {
  readonly maxWarnings?: number;
  readonly recommended: boolean;
}

/** Runs the application's real ESLint configuration with suppressions exposed. */
export async function runAudit(
  project: Project,
  options: AuditOptions,
): Promise<{
  diagnostics: Diagnostic[];
  findings: AuditFinding[];
  exemptions: Exemption[];
}> {
  const files = await sourceFiles(project.root);
  if (files.length === 0) {
    return {
      diagnostics: [
        {
          id: "audit.no-source",
          category: "coverage",
          status: "error",
          message: "No application source files were found.",
          action: "Select one application directory.",
        },
      ],
      findings: [],
      exemptions: [],
    };
  }

  let ESLint: typeof ESLintType;
  let supportsBulkSuppressions: boolean;
  let ordinaryEngine: ESLintType;
  let ordinary: LintResult[];
  let exposed: LintResult[];
  try {
    ESLint = await eslintForProject(project);
    supportsBulkSuppressions = Number.parseInt(ESLint.version, 10) >= 10;
    ordinaryEngine = new ESLint({
      cwd: project.root,
      // ESLint 9 rejects these options and does not apply bulk suppressions
      // through its API, so its findings remain visible and unsuppressed.
      ...(supportsBulkSuppressions
        ? {
            applySuppressions: true,
            suppressionsLocation: await locateSuppressions(project),
          }
        : {}),
    });
    const exposedEngine = new ESLint({
      cwd: project.root,
      allowInlineConfig: false,
      overrideConfig: {
        rules: {
          "no-restricted-imports": [
            "error",
            {
              paths: ["next-xss-sbyd/restricted"],
              patterns: ["safevalues", "safevalues/*"],
            },
          ],
          "no-restricted-modules": [
            "error",
            {
              patterns: [
                "safevalues",
                "safevalues/*",
                "next-xss-sbyd/restricted",
              ],
            },
          ],
          "no-restricted-syntax": [
            "error",
            {
              selector:
                "ImportExpression[source.value=/^(?:safevalues(?:\\/|$)|next-xss-sbyd\\/restricted$)/]",
              message:
                "Restricted import from safevalues or next-xss-sbyd/restricted requires review.",
            },
          ],
        },
      },
    });
    [ordinary, exposed] = await Promise.all([
      ordinaryEngine.lintFiles(files),
      exposedEngine.lintFiles(files),
    ]);
  } catch (error) {
    return {
      diagnostics: [
        {
          id: "audit.failed",
          category: "coverage",
          status: "error",
          message: `ESLint analysis failed: ${String(error)}`,
          action:
            "Install and fix the application's ESLint configuration; incomplete analysis cannot pass.",
          evidence: error instanceof Error ? error.stack : undefined,
        },
      ],
      findings: [],
      exemptions: [],
    };
  }

  const failures = analysisFailures(project, [...ordinary, ...exposed]);
  if (failures.length > 0) return {
    diagnostics: [{
      id: "audit.failed", category: "coverage", status: "error",
      message: `ESLint could not analyze ${failures.length} source result(s).`,
      action: "Fix parser and project-service errors; incomplete analysis cannot pass.",
      evidence: failures.join("\n"),
    }],
    findings: [], exemptions: [],
  };
  const diagnostics: Diagnostic[] = [];
  const { aliases, ignored } = await aliasesAndIgnored(ordinaryEngine, files);
  const ordinaryFindings = findings(ordinary, aliases, "app-effective");
  const exposedFindings = findings(exposed, aliases, "app-effective");
  const identities = new Set(
    ordinaryFindings.map(
      (item) =>
        `${item.file}:${item.line}:${item.column}:${item.ruleId}:${item.messageId}`,
    ),
  );
  const hidden = exposedFindings
    .filter(
      (item) =>
        !identities.has(
          `${item.file}:${item.line}:${item.column}:${item.ruleId}:${item.messageId}`,
        ),
    )
    .map((item) => ({ ...item, suppressed: true }));
  let all = normalizePaths(project, [...ordinaryFindings, ...hidden]);

  if (options.recommended) {
    try {
      const pluginPath = requireFromApp(project).resolve("eslint-plugin-next-xss-sbyd");
      const loaded = (await import(pathToFileURL(pluginPath).href)) as {
        default: { configs: { recommended: unknown } };
      };
      const recommended = loaded.default.configs
        .recommended as ESLintType.Options["overrideConfig"];
      const recommendedEngine = new ESLint({
        cwd: project.root,
        overrideConfigFile: true,
        overrideConfig: recommended,
      });
      const recommendedResults = await recommendedEngine.lintFiles(files);
      const recommendedFailures = analysisFailures(project, recommendedResults);
      if (recommendedFailures.length > 0) throw new Error(recommendedFailures.join("\n"));
      all = [
        ...all,
        ...normalizePaths(
          project,
          findings(
            recommendedResults,
            new Set(["xss-sbyd"]),
            "recommended",
          ),
        ),
      ];
    } catch (error) {
      diagnostics.push({
        id: "audit.recommended-failed",
        category: "planning",
        status: "error",
        message: `The installed recommended preset could not be evaluated: ${String(error)}`,
        action:
          "Install a compatible eslint-plugin-next-xss-sbyd in the application and retry.",
        evidence: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  const { exemptions, diagnostics: exemptionDiagnostics } = await exemptionInventory(
    project,
    ordinary,
    exposed,
    aliases,
  );
  diagnostics.push(...exemptionDiagnostics);
  // Defensively require a parsed rule entry before advising about unapplied suppressions.
  if (!supportsBulkSuppressions && exemptions.some((item) => item.kind === "bulk" && item.ruleId !== undefined))
    diagnostics.push({
      id: "audit.bulk-suppressions-unapplied",
      category: "exemptions",
      status: "warning",
      message: `The audit found bulk suppression entries, but ESLint ${ESLint.version} cannot apply them through the programming interface used by this audit. Matching findings remain active and can fail the audit even when running ESLint directly passes.`,
      action:
        "Fix the findings, or upgrade the application to a compatible ESLint 10 version if the audit should honor bulk exceptions for error-severity findings. Warning-severity findings remain active on both engines.",
    });
  const missingReasons = exemptions.filter(
    (item) => item.kind === "inline" && !item.justification,
  );
  if (missingReasons.length > 0)
    diagnostics.push({
      id: "audit.exemption-unjustified",
      category: "exemptions",
      status: "error",
      message: `${missingReasons.length} inline xss-sbyd exemption(s) lack a documented justification.`,
      action: "Remove the suppression or add a narrow justification after --.",
    });
  const reviewed = exemptions.filter((item) => item.kind !== "inline");
  if (reviewed.length > 0)
    diagnostics.push({
      id: "audit.reviewed-exemptions",
      category: "exemptions",
      status: "warning",
      message: `${reviewed.length} bulk suppression or restricted import(s) require manual review.`,
      action:
        "Review the inventory and track the rationale in the application's normal review system.",
    });
  const remediationWarnings = all.filter(
    (item) =>
      item.scope === "app-effective" &&
      !item.setup &&
      item.severity === 1 &&
      !item.suppressed,
  ).length;
  if (
    options.maxWarnings !== undefined &&
    remediationWarnings > options.maxWarnings
  ) {
    diagnostics.push({
      id: "audit.warning-budget",
      category: "ratchet",
      status: "error",
      message: `${remediationWarnings} remediation warnings exceed --max-warnings ${options.maxWarnings}.`,
      action:
        "Fix findings or restore the prior versioned baseline; never raise the budget implicitly.",
    });
  }
  const errors = all.filter(
    (item) =>
      item.scope === "app-effective" && item.severity === 2 && !item.suppressed,
  ).length;
  if (errors > 0)
    diagnostics.push({
      id: "audit.finding-errors",
      category: "findings",
      status: "error",
      message: `${errors} unsuppressed error-severity security finding(s).`,
      action: "Remediate or narrowly document each finding before advancing.",
    });
  if (ignored.length > 0)
    diagnostics.push({
      id: "audit.ignored-source",
      category: "coverage",
      status: "error",
      message: `${ignored.length} discovered application source file(s) are ignored by ESLint.`,
      action:
        "Cover tests, stories, routes, and present JS/TS classes; review generated sources separately.",
      evidence: ignored.map((file) => relativePath(project, file)).join(", "),
    });
  if (options.recommended)
    diagnostics.push({
      id: "audit.recommended-scope",
      category: "planning",
      status: "warning",
      message:
        "Recommended-preset findings are labeled recommended and are not current application findings.",
      action: "Remediate them before enabling the recommended preset.",
    });
  const responseInventory = await inventoryResponses(project.root);
  diagnostics.push({
    id: "audit.response-inventory",
    category: "heuristic",
    status: responseInventory.length === 0 ? "pass" : "warning",
    message: `The response inventory found ${responseInventory.length} response sink site(s).`,
    action: responseInventory.length === 0
      ? "No heuristic response sites were found; nothing to review."
      : "Review HTML constructors, safeSend/safeEnd/safePipe sites, and Pages/custom Node wrapper coverage manually.",
    evidence:
      responseInventory.map((item) => `${item.file}:${item.line}:${item.column} ${item.constructor}`).join(", ") ||
      "none",
  });
  diagnostics.push({
    id: "audit.summary",
    category: "findings",
    status: "pass",
    message: `${all.length} finding(s), ${remediationWarnings} remediation warning(s), ${exemptions.length} exemption(s).`,
    action:
      "Review every exception, runtime test, CSP report, and response inventory item manually.",
  });
  return { diagnostics, findings: all, exemptions };
}
