#!/usr/bin/env node
import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

async function readable(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Checks only the declared production start script, not unrelated package text. */
async function hasStartPreload(root: string): Promise<boolean> {
  const source = await readable(resolve(root, "package.json"));
  const packageJson = JSON.parse(source ?? "null") as {scripts?: {start?: unknown}} | null;
  const start = packageJson?.scripts?.start;
  return typeof start === "string" &&
    /(?:^|[\s"'=])--import(?:=|\s+)(?:next-xss-sbyd\/enforce\/preload|"next-xss-sbyd\/enforce\/preload"|'next-xss-sbyd\/enforce\/preload')(?=$|[\s"'])/u.test(start);
}

export interface GuardInstallation {
  readonly location: string;
  readonly nodeOnly: boolean;
  readonly preload: boolean;
}

/** Recognizes instrumentation filenames, including names customized by pageExtensions. */
export async function inspectGuardInstallation(
  root: string,
  pageExtensions: readonly string[] = ["ts", "js"],
): Promise<GuardInstallation | null> {
  const preload = await hasStartPreload(root);
  const suffixes = [...new Set(["ts", "js", ...pageExtensions])];
  const filenames = ["", "src/"].flatMap((prefix) =>
    suffixes.map((suffix) => `${prefix}instrumentation.${suffix}`),
  );
  for (const filename of filenames) {
    const source = await readable(resolve(root, filename));
    if (
      source !== null &&
      /next-xss-sbyd\/enforce/u.test(source) &&
      /installResponseGuard\s*\(/u.test(source)
    ) {
      return {
        location: filename,
        nodeOnly: /NEXT_RUNTIME\s*===\s*["']nodejs["']/u.test(source),
        preload,
      };
    }
  }
  if (preload) {
    return { location: "package.json scripts.start preload", nodeOnly: true, preload: true };
  }
  return null;
}

/** Verifies a statically recognizable instrumentation or preload installation. */
export async function findGuardInstallation(
  root: string,
): Promise<string | null> {
  return (await inspectGuardInstallation(root))?.location ?? null;
}

const entry = process.argv[1]
  ? await realpath(process.argv[1]).catch(() => "")
  : "";
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const root = resolve(process.argv[2] ?? ".");
  const installation = await inspectGuardInstallation(root);
  if (installation === null) {
    console.error(
      "No next-xss-sbyd response-guard installation found in instrumentation.ts or package.json preload scripts.",
    );
    process.exitCode = 1;
  } else {
    console.log(
      `next-xss-sbyd response wrapper configured by ${installation.location}`,
    );
  }
}
