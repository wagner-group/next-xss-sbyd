import { createRequire } from "node:module";
import { access, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import type { Diagnostic, Stage } from "./cli-types.js";
import { isStage } from "./cli-types.js";

export const SOURCE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
]);
export const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "storybook-static",
]);

export interface PackageJson {
  name?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: unknown;
  "next-xss-sbyd"?: { stage?: Stage };
}

export interface Project {
  readonly root: string;
  readonly packageJson: PackageJson;
  readonly packageJsonText: string;
  readonly nextMajor?: number;
  readonly reactMajor?: number;
  readonly sourceRoot: "src" | ".";
  readonly pageExtensions: readonly string[];
  readonly nextConfig?: string;
  readonly eslintConfig?: string;
  readonly tsconfig?: string;
  readonly packageManager: "npm" | "pnpm" | "yarn" | "bun";
  readonly recordedStage?: Stage;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function firstExisting(
  root: string,
  names: readonly string[],
): Promise<string | undefined> {
  for (const name of names) if (await exists(resolve(root, name))) return name;
  return undefined;
}

function dependencyMajor(value: string | undefined): number | undefined {
  const match = value?.match(/(?:^|[^0-9])(\d+)(?:\.|$)/u);
  return match ? Number(match[1]) : undefined;
}

function parsePageExtensions(source: string | null): readonly string[] {
  if (source === null) return ["js", "jsx", "ts", "tsx"];
  const match = /pageExtensions\s*:\s*\[([^\]]+)\]/u.exec(source);
  if (!match) return ["js", "jsx", "ts", "tsx"];
  const extensions = [...match[1].matchAll(/["']([^"']+)["']/gu)].map(
    (item) => item[1],
  );
  return extensions.length === 0 ? ["js", "jsx", "ts", "tsx"] : extensions;
}

/** Discovers the selected Next.js application without choosing a workspace child implicitly. */
export async function discoverProject(directory: string): Promise<Project> {
  const root = await realpath(resolve(directory));
  const packagePath = resolve(root, "package.json");
  let packageJsonText: string;
  try {
    packageJsonText = await readFile(packagePath, "utf8");
  } catch {
    throw new Error(
      `No package.json found in selected application directory: ${root}`,
    );
  }
  const packageJson = JSON.parse(packageJsonText) as PackageJson;
  const deps = { ...packageJson.devDependencies, ...packageJson.dependencies };
  const nextConfig = await firstExisting(root, [
    "next.config.ts",
    "next.config.mjs",
    "next.config.js",
    "next.config.cjs",
  ]);
  const eslintConfig = await firstExisting(root, [
    "eslint.config.ts",
    "eslint.config.mjs",
    "eslint.config.js",
    "eslint.config.cjs",
  ]);
  const tsconfig = await firstExisting(root, ["tsconfig.json"]);
  const sourceRoot = (await exists(resolve(root, "src"))) ? "src" : ".";
  const configSource = nextConfig
    ? await readFile(resolve(root, nextConfig), "utf8")
    : null;
  let packageManager: Project["packageManager"] = "npm";
  if (await exists(resolve(root, "pnpm-lock.yaml"))) packageManager = "pnpm";
  else if (await exists(resolve(root, "yarn.lock"))) packageManager = "yarn";
  else if (
    (await exists(resolve(root, "bun.lock"))) ||
    (await exists(resolve(root, "bun.lockb")))
  ) {
    packageManager = "bun";
  }
  return {
    root,
    packageJson,
    packageJsonText,
    nextMajor: dependencyMajor(deps.next),
    reactMajor: dependencyMajor(deps.react),
    sourceRoot,
    pageExtensions: parsePageExtensions(configSource),
    nextConfig,
    eslintConfig,
    tsconfig,
    packageManager,
    recordedStage: isStage(packageJson["next-xss-sbyd"]?.stage ?? "")
      ? packageJson["next-xss-sbyd"]!.stage
      : undefined,
  };
}

/** Returns application source files, including ignored and generated files for coverage inventory. */
export async function sourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name)))
        files.push(path);
    }
  }
  await visit(root);
  return files.sort();
}

export function relativePath(project: Project, path: string): string {
  return relative(project.root, path).replaceAll("\\", "/");
}

export function frameworkDiagnostics(project: Project): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (
    project.nextMajor === undefined ||
    project.nextMajor < 14 ||
    project.nextMajor > 16
  )
    diagnostics.push({
      id: "framework.next-version",
      category: "framework",
      status: "error",
      message: `Next.js ${project.nextMajor ?? "version is not declared"}; supported majors are 14-16.`,
      action:
        "Declare and install a supported Next.js version in this application.",
    });
  if (
    project.reactMajor === undefined ||
    project.reactMajor < 18 ||
    project.reactMajor > 19
  )
    diagnostics.push({
      id: "framework.react-version",
      category: "framework",
      status: "error",
      message: `React ${project.reactMajor ?? "version is not declared"}; supported majors are 18-19.`,
      action:
        "Declare and install a supported React version in this application.",
    });
  if (!project.tsconfig)
    diagnostics.push({
      id: "typescript.missing",
      category: "coverage",
      status: "error",
      message: "No application tsconfig.json was found.",
      action: "Add a tsconfig.json that covers every application source class.",
    });
  return diagnostics;
}

/** Resolves distinct physical SafeValues installations without counting symlinks twice. */
export async function safevaluesInstallations(
  project: Project,
): Promise<Array<{ path: string; version: string }>> {
  const found = new Map<string, { path: string; version: string }>();
  async function record(packageJsonPath: string): Promise<void> {
    const physical = await realpath(dirname(packageJsonPath));
    const metadata = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      version?: string;
    };
    found.set(physical, {
      path: relative(project.root, physical) || ".",
      version: metadata.version ?? "unknown",
    });
  }
  const requireFromApp = createRequire(resolve(project.root, "package.json"));
  try {
    const entry = requireFromApp.resolve("safevalues");
    await record(resolve(dirname(entry), "../../package.json"));
  } catch {
    // The caller reports an unresolved installation if neither resolution path works.
  }
  try {
    const entry = requireFromApp.resolve("next-xss-sbyd");
    const requireFromLibrary = createRequire(
      resolve(dirname(entry), "../package.json"),
    );
    const safevaluesEntry = requireFromLibrary.resolve("safevalues");
    await record(resolve(dirname(safevaluesEntry), "../../package.json"));
  } catch {
    // A missing next-xss-sbyd installation is reported by the configuration checks.
  }
  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function managerInstallCommand(
  project: Project,
  packages: readonly string[],
  dev: boolean,
): { command: string; args: string[] } {
  const verb = project.packageManager === "npm" ? "install" : "add";
  const devFlag =
    project.packageManager === "npm" || project.packageManager === "pnpm"
      ? "--save-dev"
      : "--dev";
  return {
    command: project.packageManager,
    args: [verb, ...(dev ? [devFlag] : []), ...packages],
  };
}

export function integrationBasename(project: Project, base: string): string {
  const standard = ["ts", "tsx", "js", "jsx"].find((extension) =>
    project.pageExtensions.includes(extension),
  );
  return `${base}.${standard ?? project.pageExtensions[0] ?? "ts"}`;
}
