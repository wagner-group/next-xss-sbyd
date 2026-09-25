import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ESLint as ESLintType } from "eslint";
import type { Diagnostic, Stage } from "./cli-types.js";
import { stageIndex } from "./cli-types.js";
import type { Project } from "./project.js";
import {
  frameworkDiagnostics,
  integrationBasename,
  safevaluesInstallations,
  sourceFiles,
} from "./project.js";
import { inspectGuardInstallation } from "./check-guard.js";

async function readable(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function diagnostic(
  id: string,
  category: string,
  status: Diagnostic["status"],
  message: string,
  action: string,
  evidence?: string,
): Diagnostic {
  return {
    id,
    category,
    status,
    message,
    action,
    ...(evidence ? { evidence } : {}),
  };
}

async function eslintForProject(project: Project): Promise<typeof ESLintType> {
  const requireFromApp = createRequire(resolve(project.root, "package.json"));
  const location = requireFromApp.resolve("eslint");
  const module = (await import(
    pathToFileURL(location).href
  )) as typeof import("eslint");
  return module.ESLint;
}

export async function checkLint(
  project: Project,
  stage: Stage,
): Promise<Diagnostic[]> {
  if (!project.eslintConfig)
    return [
      diagnostic(
        "eslint.config-missing",
        "lint",
        "error",
        "No application ESLint flat config was found.",
        "Create an eslint.config.* file and include the selected next-xss-sbyd preset.",
      ),
    ];
  try {
    const ESLint = await eslintForProject(project);
    const eslint = new ESLint({ cwd: project.root });
    const presetName = stage === "lint" || stage === "runtime" ? "lintMigration" : "recommended";
    const files = await sourceFiles(project.root);
    if (files.length === 0)
      return [
        diagnostic(
          "eslint.no-source",
          "coverage",
          "error",
          "No application JavaScript or TypeScript source files were discovered.",
          "Select the application directory explicitly.",
        ),
      ];
    const requiredSeverity = stage === "lint" || stage === "runtime" ? 1 : 2;
    const ignored: string[] = [];
    const weakened: string[] = [];
    const wrongStage: string[] = [];
    let checked = 0;
    for (const file of files) {
      if (await eslint.isPathIgnored(file)) {
        ignored.push(file);
        continue;
      }
      const config = await eslint.calculateConfigForFile(file);
      checked += 1;
      const plugins = (config?.plugins ?? {}) as Record<
        string,
        { meta?: { name?: string }; configs?: Record<string, Array<{rules?: Record<string, unknown>}>> }
      >;
      const pluginEntry = Object.entries(plugins).find(
          ([, plugin]) => plugin.meta?.name === "eslint-plugin-next-xss-sbyd",
        );
      const alias = pluginEntry?.[0] ?? "xss-sbyd";
      const presets = [presetName, ...(project.packageJson["next-xss-sbyd"]?.markdown ? [requiredSeverity === 1 ? "markdownMigration" : "markdown"] : [])];
      const requiredRules = Object.assign({}, ...presets.flatMap((name) => pluginEntry?.[1].configs?.[name] ?? [])
        .map((entry) => entry.rules ?? {})) as Record<string, unknown>;
      for (const [canonicalName, expected] of Object.entries(requiredRules)) {
        const ruleName = `${alias}/${canonicalName.slice(canonicalName.indexOf("/") + 1)}`;
        const actual = config?.rules?.[ruleName];
        const actualSeverity = Array.isArray(actual) ? Number(actual[0]) : Number(actual ?? 0);
        const expectedSetting = Array.isArray(expected) ? expected : [expected];
        const expectedSeverity = expectedSetting[0] === "error" ? 2 : expectedSetting[0] === "warn" ? 1 : Number(expectedSetting[0]);
        if (actualSeverity !== expectedSeverity ||
            JSON.stringify(Array.isArray(actual) ? actual.slice(1) : []) !== JSON.stringify(expectedSetting.slice(1))) {
          weakened.push(`${file} (${ruleName})`);
        }
      }
      const findingRule = config?.rules?.[`${alias}/no-danger`];
      const findingSeverity = Array.isArray(findingRule) ? Number(findingRule[0]) : 0;
      if (findingSeverity !== requiredSeverity) wrongStage.push(`${file} (${findingSeverity})`);
    }
    if (checked === 0)
      return [
        diagnostic(
          "eslint.no-covered-source",
          "coverage",
          "error",
          "Every discovered application source file is ignored by ESLint.",
          "Cover the selected application's source files with type-aware ESLint.",
        ),
      ];
    const ordinaryIgnored = ignored.filter(
      (file) => !/\.generated\./u.test(file),
    );
    const diagnostics: Diagnostic[] = [];
    if (weakened.length > 0)
      diagnostics.push(
        diagnostic(
          "eslint.preset-weakened",
          "lint",
          "error",
          `The effective xss-sbyd rules are absent or weakened for ${weakened.length} application source file(s).`,
          `Apply xssSbyd.configs.${requiredSeverity === 1 ? "lintMigration" : "recommended"} without later weakening overrides.`,
          weakened.join(", "),
        ),
      );
    if (wrongStage.length > 0)
      diagnostics.push(
        diagnostic(
          "eslint.preset-stage",
          "lint",
          "error",
          `${wrongStage.length} application source file(s) do not use severity ${requiredSeverity} required by stage ${stage}.`,
          `Apply xssSbyd.configs.${requiredSeverity === 1 ? "lintMigration" : "recommended"} after all later overrides.`,
          wrongStage.join(", "),
        ),
      );
    if (ordinaryIgnored.length > 0)
      diagnostics.push(
        diagnostic(
          "eslint.ignored-source",
          "coverage",
          "error",
          `${ordinaryIgnored.length} application source file(s) are ignored by ESLint.`,
          "Remove ignores for tests, stories, route handlers, and present JS/TS classes.",
          ordinaryIgnored.join(", "),
        ),
      );
    if (diagnostics.length === 0)
      diagnostics.push(
        diagnostic(
          "eslint.effective",
          "lint",
          "pass",
          `Effective ESLint configuration matches the ${stage === "lint" || stage === "runtime" ? "migration" : "recommended"} severity contract.`,
          "Keep application source, tests, stories, and route handlers covered.",
        ),
      );
    return diagnostics;
  } catch (error) {
    return [
      diagnostic(
        "eslint.analysis-failed",
        "coverage",
        "error",
        `Effective ESLint configuration could not be evaluated: ${String(error)}`,
        "Fix ESLint loading and parser-service errors, then rerun check-config.",
      ),
    ];
  }
}

export async function checkRuntime(project: Project): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const tsconfig = project.tsconfig
    ? await readable(resolve(project.root, project.tsconfig))
    : null;
  if (!tsconfig || !/"jsxImportSource"\s*:\s*"next-xss-sbyd"/u.test(tsconfig))
    diagnostics.push(
      diagnostic(
        "runtime.jsx-import-source",
        "runtime",
        "error",
        "The selected tsconfig does not set jsxImportSource to next-xss-sbyd.",
        "Set the effective compilerOptions.jsxImportSource to next-xss-sbyd without changing sibling projects.",
      ),
    );
  const nextSource = project.nextConfig
    ? await readable(resolve(project.root, project.nextConfig))
    : null;
  for (const alias of ["next/link", "next/image", "next/form"] as const) {
    const target = `next-xss-sbyd/compat/${alias.slice(5)}`;
    if (
      !nextSource?.includes(alias) ||
      !nextSource.includes(target) ||
      !nextSource.includes("turbopack") ||
      !nextSource.includes("webpack")
    )
      diagnostics.push(
        diagnostic(
          `runtime.alias.${alias.slice(5)}`,
          "runtime",
          "error",
          `${alias} is not recognizably aliased to ${target} in both Turbopack and webpack.`,
          "Configure both turbopack.resolveAlias and webpack resolve.alias; preserve existing callbacks.",
        ),
      );
  }
  const instrumentation = integrationBasename(
    project,
    `${project.sourceRoot === "src" ? "src/" : ""}instrumentation`,
  );
  const guard = await inspectGuardInstallation(
    project.root,
    project.pageExtensions,
  );
  if (!guard)
    diagnostics.push(
      diagnostic(
        "runtime.response-guard",
        "runtime",
        "error",
        "No recognizable response-guard installation was found.",
        `Create ${instrumentation} with a Node-runtime guarded install, or preload next-xss-sbyd/enforce/preload before framework imports.`,
      ),
    );
  if (guard && !guard.nodeOnly) {
    const sources = await sourceFiles(project.root);
    const hasEdge =
      (project.nextMajor !== 16 &&
        (await readable(
          resolve(project.root, integrationBasename(project, "middleware")),
        )) !== null) ||
      (await Promise.all(sources.map((file) => readable(file)))).some(
        (source) => /runtime\s*=\s*["']edge["']/u.test(source ?? ""),
      );
    if (hasEdge)
      diagnostics.push(
        diagnostic(
          "runtime.edge-guard",
          "runtime",
          "error",
          "installResponseGuard() can run in an Edge bundle and will throw.",
          'Guard the dynamic import and call with process.env.NEXT_RUNTIME === "nodejs".',
          guard.location,
        ),
      );
  }
  if (project.nextMajor === 14 && !nextSource?.includes("instrumentationHook"))
    diagnostics.push(
      diagnostic(
        "runtime.next14-hook",
        "runtime",
        "error",
        "Next.js 14 requires experimental.instrumentationHook.",
        "Enable experimental.instrumentationHook in next.config.",
      ),
    );
  diagnostics.push(
    diagnostic(
      "runtime.preload-order",
      "runtime",
      guard?.preload ? "pass" : "warning",
      guard?.preload
        ? "A response-guard preload is configured in package.json scripts.start."
        : "Instrumentation does not prove NextResponse constructor ordering for self-hosted or custom servers.",
      guard?.preload
        ? "Keep the preload before framework imports in every deployed server command."
        : "Use NODE_OPTIONS=--import next-xss-sbyd/enforce/preload when authoritative NextResponse coverage is required.",
    ),
  );
  return diagnostics;
}

export async function checkCsp(
  project: Project,
  stage: Stage,
): Promise<Diagnostic[]> {
  const base = project.nextMajor === 16 ? "proxy" : "middleware";
  const file = integrationBasename(project, `${project.sourceRoot === "src" ? "src/" : ""}${base}`);
  const source = await readable(resolve(project.root, file));
  if (!source)
    return [
      diagnostic(
        "csp.missing",
        "csp",
        "error",
        `No ${file} was found.`,
        "Add an application-selected matcher and compose withXssSbydHeaders outermost around the existing handler.",
      ),
    ];
  if (
    !source.includes("withXssSbydHeaders") &&
    !source.includes("createXssSbydHandler")
  )
    return [
      diagnostic(
        "csp.wrapper",
        "csp",
        "error",
        `${file} has no recognizable next-xss-sbyd CSP wrapper.`,
        "Compose withXssSbydHeaders outermost without changing authentication, redirects, rewrites, cookies, or forwarded headers.",
      ),
    ];
  const reportOnly = /mode\s*:\s*["']report-only["']/u.test(source);
  if (stage === "enforce" && reportOnly)
    return [
      diagnostic(
        "csp.report-only",
        "csp",
        "error",
        "CSP remains report-only for the enforce stage.",
        "Review production reports and behavior, then select enforcement explicitly.",
        file,
      ),
    ];
  if (stage === "csp-report" && !reportOnly)
    return [
      diagnostic(
        "csp.not-report-only",
        "csp",
        "error",
        "The csp-report stage requires an explicit report-only policy.",
        'Configure mode: "report-only" with a real application-owned report endpoint and matcher.',
        file,
      ),
    ];
  return [
    diagnostic(
      "csp.configured",
      "csp",
      "pass",
      `A recognizable ${reportOnly ? "report-only" : "enforced"} CSP integration is present.`,
      "Verify matcher coverage, static/ISR/PPR behavior, nonce equality, and reports in production.",
      file,
    ),
  ];
}

/** Runs shared, stage-aware configuration checks without a source finding audit. */
export async function checkConfiguration(
  project: Project,
  stage: Stage,
): Promise<Diagnostic[]> {
  const diagnostics = frameworkDiagnostics(project);
  const lintScripts = Object.entries(project.packageJson.scripts ?? {}).filter(
    ([name]) => /lint|check|ci/u.test(name),
  );
  for (const [name, script] of lintScripts) {
    if (script.includes("--pass-on-unpruned-suppressions"))
      diagnostics.push(
        diagnostic(
          "eslint.unpruned-suppressions",
          "exemptions",
          "error",
          `Script ${name} permits stale bulk suppressions.`,
          "Remove --pass-on-unpruned-suppressions and review/prune eslint-suppressions.json.",
        ),
      );
    if (script.includes("--suppressions-location"))
      diagnostics.push(
        diagnostic(
          "eslint.custom-suppressions",
          "exemptions",
          "warning",
          `Script ${name} selects a custom bulk-suppression file.`,
          "Ensure audit uses and reviews the same file; bulk xss-sbyd entries require justification.",
        ),
      );
  }
  if (
    project.recordedStage &&
    stageIndex(project.recordedStage) < stageIndex(stage)
  )
    diagnostics.push(
      diagnostic(
        "stage.marker-behind",
        "stage",
        "error",
        `package.json records stage ${project.recordedStage}, behind requested stage ${stage}.`,
        `Advance with enable-config --stage ${stage}; do not edit the marker alone.`,
      ),
    );
  diagnostics.push(...(await checkLint(project, stage)));
  if (stageIndex(stage) >= stageIndex("runtime"))
    diagnostics.push(...(await checkRuntime(project)));
  else
    diagnostics.push(
      diagnostic(
        "runtime.pending",
        "runtime",
        "pass",
        "Runtime protections are intentionally pending at the lint stage.",
        "Complete source remediation before selecting the runtime stage.",
      ),
    );
  if (stageIndex(stage) >= stageIndex("csp-report"))
    diagnostics.push(...(await checkCsp(project, stage)));
  else
    diagnostics.push(
      diagnostic(
        "csp.pending",
        "csp",
        "pass",
        "CSP is intentionally pending at this stage.",
        "Test runtime enforcement, adopt recommended lint, then configure report-only CSP.",
      ),
    );
  const installations = await safevaluesInstallations(project);
  if (installations.length === 0)
    diagnostics.push(
      diagnostic(
        "dependencies.safevalues-unresolved",
        "dependencies",
        "error",
        "No physical safevalues installation could be resolved.",
        "Reinstall next-xss-sbyd and its dependencies with the selected package manager.",
      ),
    );
  else if (installations.length > 1)
    diagnostics.push(
      diagnostic(
        "dependencies.safevalues-duplicate",
        "dependencies",
        "error",
        `${installations.length} distinct physical safevalues copies were found.`,
        "Remove direct application dependencies and deduplicate so builders and sinks share next-xss-sbyd's copy.",
        installations
          .map((item) => `${item.path} (${item.version})`)
          .join(", "),
      ),
    );
  else
    diagnostics.push(
      diagnostic(
        "dependencies.safevalues-single",
        "dependencies",
        "pass",
        `One physical safevalues copy (${installations[0].version}) was resolved.`,
        "Import builders only from next-xss-sbyd.",
        installations[0].path,
      ),
    );
  return diagnostics;
}
