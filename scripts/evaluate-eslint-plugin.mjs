import {readFile} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {ESLint} from "eslint";
import parser from "@typescript-eslint/parser";
import plugin from "../eslint-plugin-next-xss-sbyd/dist/index.js";

const repository = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Usage: node scripts/evaluate-eslint-plugin.mjs <repository>");

const recommended = plugin.configs.recommended[1].rules;
const eslint = new ESLint({
  cwd: repository,
  overrideConfigFile: true,
  errorOnUnmatchedPattern: false,
  overrideConfig: [
    {ignores: ["**/.next/**", "**/node_modules/**", "**/dist/**", "**/build/**", "**/coverage/**", "**/*.generated.*", "**/.contentlayer/**"]},
    {
      files: ["**/*.{ts,tsx}"],
      languageOptions: {parser, parserOptions: {projectService: true, tsconfigRootDir: repository, ecmaFeatures: {jsx: true}}},
      plugins: {"xss-sbyd": plugin},
      rules: recommended,
    },
  ],
});

const results = await eslint.lintFiles(["**/*.{ts,tsx}"]);
let sourceLines = 0;
for (const result of results) {
  if (result.messages.some((message) => message.fatal)) continue;
  sourceLines += (await readFile(result.filePath, "utf8")).split(/\r?\n/u).length;
}
const allMessages = results.flatMap((result) => result.messages.map((message) => ({
  file: path.relative(repository, result.filePath),
  line: message.line ?? null,
  ruleId: message.ruleId,
  severity: message.severity,
  message: message.message,
  fatal: message.fatal ?? false,
})));
const findings = allMessages.filter((finding) => finding.ruleId?.startsWith("xss-sbyd/"));
const ruleCounts = {};
for (const finding of findings) ruleCounts[finding.ruleId] = (ruleCounts[finding.ruleId] ?? 0) + 1;
const infrastructureMessages = allMessages.filter((finding) => !finding.ruleId?.startsWith("xss-sbyd/"));
process.stdout.write(`${JSON.stringify({repository, sourceLines, fileCount: results.length, findingCount: findings.length, ruleCounts, findings, infrastructureMessages}, null, 2)}\n`);
