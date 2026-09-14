import assert from "node:assert/strict";
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {ESLint} from "eslint";
import plugin from "../dist/index.js";
import {passiveTypes} from "../../tests/passive-content-cases.mjs";

// Exercise real files with the entire recommended preset and application type services.
test("recommended preset shares the response MIME policy across header writers", async (t) => {
  const temporaryRoot = fileURLToPath(new URL("../../tmp/", import.meta.url));
  await mkdir(temporaryRoot, {recursive: true});
  const root = await mkdtemp(join(temporaryRoot, "issue-219-lint-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: {strict: true, lib: ["ES2022", "DOM"], jsx: "react-jsx", jsxImportSource: "next-xss-sbyd"},
    include: ["*.ts"],
  }));
  const cases = [
    ...["image/svg+xml", "text/xml", "application/xml", "IMAGE/SVG+XML; charset=utf-8", "application/pdf", "multipart/x-mixed-replace", "text/javascript", "text/css", "audio/example+xml", "image/unknown", "text/example+json", "application/+json"].map(value => [value, "active"]),
    ...["text/html", "application/xhtml+xml", "application/example+html"].map(value => [value, "html"]),
    ...["text/html; charset", "image/svg+xml; charset", "", "garbage", "text/plain, text/html", "text/plain;", "text/plain; charset", 'text/plain; charset="unterminated'].map(value => [value, "invalidMedia"]),
    ...[...passiveTypes, ...passiveTypes.map(type => `${type}; charset=utf-8`), "Text/Plain; charset=utf-8", 'application/json; profile="a;b"'].map(value => [value, null]),
  ];
  const expected = [];
  const lines = ['declare const headers: Headers;', 'declare const response: import("node:http").ServerResponse;'];
  for (const [value, messageId] of cases) {
    const literal = JSON.stringify(value);
    for (const code of [
      `headers.set("Content-Type", ${literal});`,
      `headers.append("content-type", ${literal});`,
      `headers["set"]("CONTENT-TYPE", ${literal});`,
      `response.setHeader("Content-Type", ${literal});`,
      `response.writeHead(200, {"Content-Type": ${literal}});`,
      `response.writeHead(200, "OK", {"Content-Type": ${literal}});`,
      `new Response("body", {headers: {"Content-Type": ${literal}}});`,
    ]) {
      lines.push(code);
      if (messageId) expected.push([lines.length, "xss-sbyd/no-html-content-type", messageId]);
    }
  }
  await writeFile(join(root, "headers.ts"), lines.join("\n"));
  const eslint = new ESLint({cwd: root, overrideConfigFile: true,
    overrideConfig: plugin.configs.recommended.map(entry => entry.languageOptions ? {
      ...entry, languageOptions: {...entry.languageOptions, parserOptions: {
        ...entry.languageOptions.parserOptions, tsconfigRootDir: root,
      }},
    } : entry),
  });
  const [result] = await eslint.lintFiles(["headers.ts"]);
  for (const [index, [value]] of cases.entries()) {
    const firstLine = 3 + index * 7;
    const lastLine = firstLine + 7;
    assert.deepEqual(result.messages.filter(({line}) => line >= firstLine && line < lastLine)
      .map(({line, ruleId, messageId}) => [line, ruleId, messageId]),
    expected.filter(([line]) => line >= firstLine && line < lastLine), `Content-Type ${JSON.stringify(value)}`);
  }
});
