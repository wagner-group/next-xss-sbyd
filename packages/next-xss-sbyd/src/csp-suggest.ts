#!/usr/bin/env node
import {readFile} from "node:fs/promises";

import {reportsToCspOptions, type CspViolationReport} from "./csp.js";

function isNormalizedReport(value: unknown): value is CspViolationReport {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const report = value as Record<string, unknown>;
  const optionalStrings = ["documentURL", "disposition", "originalPolicy", "referrer", "sourceFile"];
  const optionalNumbers = ["columnNumber", "lineNumber", "statusCode"];
  return typeof report.blockedOrigin === "string"
    && typeof report.sample === "string"
    && typeof report.violatedDirective === "string"
    && optionalStrings.every((name) => report[name] === undefined || typeof report[name] === "string")
    && optionalNumbers.every((name) => report[name] === undefined || typeof report[name] === "number");
}

function validateReports(values: unknown[]): CspViolationReport[] {
  if (!values.every(isNormalizedReport)) throw new TypeError("Invalid normalized CSP report");
  return values;
}

function parseReports(source: string): CspViolationReport[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    // Fall through to JSON Lines.
  }
  if (Array.isArray(parsed)) return validateReports(parsed);
  try {
    const lines = source.split(/\r?\n/u).filter((line) => line.trim() !== "");
    if (lines.length > 0) return validateReports(lines.map((line) => JSON.parse(line) as unknown));
  } catch (error) {
    if (error instanceof TypeError) throw error;
    // Report the stable user-facing error below.
  }
  throw new SyntaxError("Expected a JSON array or one JSON object per line");
}

try {
  let input: string;
  if (process.argv[2] !== undefined) input = await readFile(process.argv[2], "utf8");
  else {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    input = Buffer.concat(chunks).toString("utf8");
  }
  const result = reportsToCspOptions(parseReports(input));
  console.log(JSON.stringify(result.options, null, 2));
  for (const warning of result.warnings) console.error(`warning: ${warning}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
