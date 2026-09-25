#!/usr/bin/env node
import { readFile, realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SOURCE_EXTENSIONS, sourceFiles } from "./project.js";

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

export interface MarkdownInventoryFinding {
  category: "document" | "renderer-or-pipeline" | "configuration" | "html-sink" | "unknown-wrapper" | "coverage";
  file: string;
  line: number;
  column: number;
  detail: string;
}

/** Inventories Markdown documents and candidate integration sites; this is not a safety proof. */
export async function inventoryMarkdown(root: string): Promise<MarkdownInventoryFinding[]> {
  const findings: MarkdownInventoryFinding[] = [];
  const extensions = new Set([...SOURCE_EXTENSIONS, ".md", ".mdx"]);
  for (const file of await sourceFiles(root, extensions)) {
    const name = relative(root, file);
    if (/\.mdx?$/iu.test(file)) {
      findings.push({file: name, line: 1, column: 1, category: "document", detail: file.endsWith(".mdx")
        ? "MDX discovered; executable contents are not analyzed by JS/TS lint. Review as application code."
        : "Markdown discovered; trace its consumer and renderer configuration."});
      continue;
    }
    const source = await readFile(file, "utf8");
    const patterns: Array<[MarkdownInventoryFinding["category"], RegExp]> = [
      ["renderer-or-pipeline", /["'](?:react-markdown|markdown-to-jsx|marked|markdown-it|remark(?:-[\w-]+)?|rehype(?:-[\w-]+)?|unified|@mdx-js\/mdx|@next\/mdx|next-mdx-remote(?:-client)?|mdx-bundler)(?:\/[^"']*)?["']/gu],
      ["configuration", /\b(?:remarkPlugins|rehypePlugins|remarkRehypeOptions|urlTransform|skipHtml|allowDangerousHtml|rehypeRaw|mdxOptions|forceBlock)\b/gu],
      ["html-sink", /\b(?:dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML)\b/gu],
      ["coverage", /\b(?:import|require)\s*\(\s*(?![\s"'`])/gu],
    ];
    // Require a self-closing tag or a matching closing tag, so generic type
    // arguments such as Array<MarkdownNode> are not treated as JSX wrappers.
    for (const match of source.matchAll(/<\s*((?:[A-Z][\w.]*)?(?:Markdown|MDX)[\w.]*)\b[^<>]*>/gu)) {
      const tag = match[1]!;
      if (tag.split(".").at(-1) === "SafeMarkdown") continue;
      if (!/\/\s*>$/u.test(match[0]) && !source.includes(`</${tag}>`, match.index + match[0].length)) continue;
      findings.push({file: name, ...lineAndColumn(source, match.index), category: "unknown-wrapper", detail: match[0]});
    }
    for (const [category, pattern] of patterns) {
      for (const match of source.matchAll(pattern)) findings.push({
        file: name, ...lineAndColumn(source, match.index), category,
        detail: category === "coverage" ? "Unresolved dynamic loading; manually review possible Markdown/MDX targets." : match[0],
      });
    }
  }
  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
}

const entry = process.argv[1]
  ? await realpath(process.argv[1]).catch(() => "")
  : "";
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const root = resolve(process.argv[2] ?? ".");
  const findings = process.argv.includes("--markdown") ? await inventoryMarkdown(root) : await inventoryResponses(root);
  if (process.argv.includes("--json"))
    console.log(JSON.stringify(findings, null, 2));
  else
    for (const finding of findings) {
      console.log(
        "category" in finding
          ? `${finding.file}:${finding.line}:${finding.column} ${finding.category} ${finding.detail}`
          : `${finding.file}:${finding.line}:${finding.column} ${finding.constructor} Content-Type=${finding.contentType ?? "<not statically visible>"}`,
      );
    }
}
