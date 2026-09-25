import assert from "node:assert/strict";
import test from "node:test";
import {ESLint} from "eslint";
import plugin from "../dist/index.js";

const eslint = new ESLint({overrideConfigFile: true, overrideConfig: plugin.configs.markdown});
async function messages(code) {
  const [result] = await eslint.lintText(code, {filePath: "article.tsx"});
  return result.messages;
}

test("Markdown import boundary recognizes module forms and leaves HTML parsers available", async () => {
  for (const code of [
    'import Renamed from "react-markdown";',
    'import * as Markdown from "react-markdown";',
    'import {default as Markdown} from "react-markdown";',
    'export {default as Article} from "react-markdown";',
    'export * from "markdown-to-jsx";',
    'const {default: Markdown} = require("react-markdown");',
    'const Markdown = await import("markdown-to-jsx");',
    'import Markdown = require("react-markdown");',
    'import renderer from "rehype-react";',
    'import {useRemark} from "react-remark";',
    'export {default} from "marked-react";',
  ]) {
    assert.deepEqual((await messages(code)).map((m) => [m.ruleId, m.messageId]), [["xss-sbyd/require-safe-markdown", "boundary"]], code);
  }
  for (const code of [
    'import {marked} from "marked"; marked.parse(source);',
    'import MarkdownIt from "markdown-it";',
    'import {SafeMarkdown} from "next-xss-sbyd/markdown";',
    'import "react-markdown";',
    'import "@mdx-js/mdx";',
    'import type {Options} from "react-markdown";',
    'import {type Options} from "react-markdown";',
    'export type {Options} from "react-markdown";',
    'export {type Options} from "react-markdown";',
    'export type * from "react-markdown";',
    'function adapter(require) { return require("react-markdown"); }',
    'const require = (name) => name; require("react-markdown");',
    'function evaluate(source) { return source; } evaluate("x");',
  ]) assert.deepEqual(await messages(code), [], code);
});

test("MDX executable imports include aliases, namespaces, remotes, CommonJS and reexports", async () => {
  for (const code of [
    'import {evaluate as execute} from "@mdx-js/mdx";',
    'import {compileSync} from "@mdx-js/mdx";',
    'import {createProcessor as processor} from "@mdx-js/mdx";',
    'export {createProcessor as compiler} from "@mdx-js/mdx";',
    'import * as mdx from "@mdx-js/mdx";',
    'import {MDXRemote} from "next-mdx-remote/rsc";',
    'export {run as execute} from "@mdx-js/mdx";',
    'export * from "@mdx-js/mdx";',
    'const mdx = require("@mdx-js/mdx");',
    'const {serialize} = await import("next-mdx-remote/serialize");',
    'import {bundleMDX} from "mdx-bundler";',
    'import {getMDXComponent} from "mdx-bundler/client";',
    'import {MDXRemote} from "next-mdx-remote-client/rsc";',
    'const {serialize} = await import("next-mdx-remote-client/serialize");',
  ]) assert.deepEqual((await messages(code)).map((m) => [m.ruleId, m.messageId]), [["xss-sbyd/no-unreviewed-mdx-execution", "boundary"]], code);
  assert.deepEqual(await messages('import createMDX from "@next/mdx";'), []);
  assert.deepEqual(await messages('import {nodeTypes} from "@mdx-js/mdx";'), []);
  assert.deepEqual(await messages('function adapter(require) { return require("@mdx-js/mdx"); }'), []);
});

test("nonliteral module loaders are explicit coverage limitations, without autofixes", async () => {
  for (const code of ['import(target);', 'require(target);', 'require();', 'import(`./${target}.js`);']) {
    const findings = await messages(code);
    assert.deepEqual(findings.map((m) => [m.ruleId, m.messageId, m.severity]), [["xss-sbyd/markdown-loader-coverage", "coverage", 1]]);
    assert.ok(findings.every((m) => !m.fix && !m.suggestions));
  }
  assert.deepEqual(await messages('function load(require) { return require(target); }'), []);
});

test("migration preset warns and supports a narrowly reviewed file exception", async () => {
  const migration = new ESLint({overrideConfigFile: true, overrideConfig: plugin.configs.markdownMigration});
  const [coverage] = await migration.lintText("import(target);", {filePath: "article.tsx"});
  assert.deepEqual(coverage.messages.map((m) => [m.ruleId, m.severity]), [["xss-sbyd/markdown-loader-coverage", 1]]);
  const [warning] = await migration.lintText('import Markdown from "react-markdown";', {filePath: "article.tsx"});
  assert.equal(warning.messages[0].severity, 1);
  const [reviewed] = await migration.lintText('/* eslint-disable xss-sbyd/require-safe-markdown -- owner: security; adapter policy tested in markdown.test.mjs */\nimport Markdown from "react-markdown";', {filePath: "reviewed-adapter.tsx"});
  assert.deepEqual(reviewed.messages, []);
  assert.equal(reviewed.suppressedMessages.length, 1);
});
