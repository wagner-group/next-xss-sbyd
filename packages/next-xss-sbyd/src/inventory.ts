#!/usr/bin/env node
import { readFile, realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sourceFiles } from "./project.js";

const RESPONSE_SINK = /\bnew\s+(SafeNextResponse|SafeResponse|NextResponse|Response)\s*\(|\.\s*(safeSend|safeEnd)\s*\(|\b(safePipe)\s*\(/gu;
const CONTENT_TYPE = /["']Content-Type["']\s*:\s*(["'`])([^"'`]+)\1/iu;

export interface ResponseInventoryFinding {
  column: number;
  constructor: string;
  contentType: string | null;
  file: string;
  line: number;
}

function lineAndColumn(
  source: string,
  offset: number,
): { column: number; line: number } {
  const prefix = source.slice(0, offset);
  const line = prefix.split("\n").length;
  const lastNewline = prefix.lastIndexOf("\n");
  return { column: offset - lastNewline, line };
}

function inspect(
  file: string,
  source: string,
  root: string,
): ResponseInventoryFinding[] {
  const findings: ResponseInventoryFinding[] = [];
  const matches = [...source.matchAll(RESPONSE_SINK)];
  for (const [index, match] of matches.entries()) {
    const offset = match.index;
    const location = lineAndColumn(source, offset);
    const nextOffset = matches[index + 1]?.index ?? source.length;
    const nearby = source.slice(offset, Math.min(nextOffset, offset + 1_000));
    findings.push({
      ...location,
      constructor: match[1] ?? match[2] ?? match[3],
      contentType: CONTENT_TYPE.exec(nearby)?.[2] ?? null,
      file: relative(root, file),
    });
  }
  return findings;
}

/** Heuristically inventories standard constructors and explicit safe response sinks. */
export async function inventoryResponses(
  root: string,
): Promise<ResponseInventoryFinding[]> {
  const findings: ResponseInventoryFinding[] = [];
  for (const file of await sourceFiles(root))
    findings.push(...inspect(file, await readFile(file, "utf8"), root));
  return findings.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.column - right.column,
  );
}

const entry = process.argv[1]
  ? await realpath(process.argv[1]).catch(() => "")
  : "";
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const root = resolve(process.argv[2] ?? ".");
  const findings = await inventoryResponses(root);
  if (process.argv.includes("--json"))
    console.log(JSON.stringify(findings, null, 2));
  else
    for (const finding of findings) {
      console.log(
        `${finding.file}:${finding.line}:${finding.column} ${finding.constructor} Content-Type=${finding.contentType ?? "<not statically visible>"}`,
      );
    }
}
