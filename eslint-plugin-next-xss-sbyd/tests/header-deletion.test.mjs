import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {ESLint} from "eslint";
import parser from "@typescript-eslint/parser";
import plugin from "../dist/index.js";

const fixtures = fileURLToPath(new URL("./fixtures", import.meta.url));

function linter() {
  return new ESLint({
    cwd: fixtures,
    overrideConfigFile: true,
    overrideConfig: plugin.configs.recommended.map((entry) => entry.languageOptions ? {
      ...entry,
      languageOptions: {...entry.languageOptions, parserOptions: {
        ...entry.languageOptions.parserOptions,
        tsconfigRootDir: fixtures,
        projectService: {allowDefaultProject: ["deletion.ts", "deletion.js"]},
      }},
    } : entry),
  });
}

for (const method of ["headers.delete", "headers['delete']", "removeHeader"]) {
  for (const [argument, expected] of [
    ['"Content-Type"', "remove"],
    ['"cOnTeNt-TyPe"', "remove"],
    ['`X-Content-Type-Options`', "remove"],
    ['"x-content-type-options"', "remove"],
    ["name", "dynamicRemoval"],
    ['"X-Request-Id"', null],
  ]) {
    test(`recommended preset checks ${method}(${argument})`, async () => {
      const code = [
        'import type {ServerResponse} from "node:http";',
        'declare const name: string;',
        method === "removeHeader" ? 'declare const response: ServerResponse;' :
          'const response = new Response("body", {headers: {"Content-Type": "text/plain"}});',
        `response.${method}(${argument});`,
      ].join("\n");
      const [result] = await linter().lintText(code, {filePath: "deletion.ts"});
      assert.deepEqual(result.messages.map(({ruleId, messageId}) => [ruleId, messageId]),
        expected ? [["xss-sbyd/no-html-content-type", expected]] : []);
    });
  }
}

test("recommended preset rejects both deletions in the reported route", async () => {
  const code = `export function GET(request: Request): Response {
    const body = new URL(request.url).searchParams.get('body') ?? '';
    const response = new Response(body, {headers: {'Content-Type': 'text/plain'}});
    response.headers.delete('Content-Type');
    response.headers.delete('X-Content-Type-Options');
    return response;
  }`;
  const [result] = await linter().lintText(code, {filePath: "deletion.ts"});
  assert.deepEqual(result.messages.map(({messageId}) => messageId), ["remove", "remove"]);
});

test("header aliases are checked without rejecting unrelated collection deletion", async () => {
  const code = `
    const response = new Response("body", {headers: {"Content-Type": "text/plain"}});
    const headers = response.headers;
    headers?.delete("Content-Type");
    new Headers().delete("X-Content-Type-Options");
    declare const name: string;
    new Map<string, string>().delete(name);
    new Set<string>().delete("Content-Type");
    new URLSearchParams().delete(name);
  `;
  const [result] = await linter().lintText(code, {filePath: "deletion.ts"});
  assert.deepEqual(result.messages.map(({messageId}) => messageId), ["remove", "remove"]);
});

test("computed methods and unions cannot hide Headers deletion", async () => {
  const code = `
    declare const headers: Headers | Map<string, string>;
    headers.delete("Content-Type");
    const actual = new Headers();
    const method = "delete";
    actual[method]("Content-Type");
    actual[\`delete\`]("X-Content-Type-Options");
    actual[method]("X-Request-Id");
  `;
  const [result] = await linter().lintText(code, {filePath: "deletion.ts"});
  assert.deepEqual(result.messages.map(({messageId}) => messageId), ["remove", "remove", "remove"]);
});

test("standalone configuration requires type information", async () => {
  const eslint = new ESLint({overrideConfigFile: true, overrideConfig: [{
    languageOptions: {parser}, plugins: {"xss-sbyd": plugin},
    rules: {"xss-sbyd/no-html-content-type": "error"},
  }]});
  await assert.rejects(eslint.lintText('headers.delete("Content-Type");'), /type information/);
});

for (const [code, filePath, expected] of [
  ['declare const h: any; h.delete("Content-Type"); h.headers.delete("X-Content-Type-Options");', "deletion.ts", ["remove", "remove"]],
  ['(new Response("x").headers as any).delete("Content-Type");', "deletion.ts", ["remove"]],
  ['export function strip(res) { res.headers.delete("Content-Type"); }', "deletion.js", ["remove"]],
  ['const h = new Headers(); const method = "get"; h[method]("Content-Type");', "deletion.ts", []],
]) {
  test(`recommended preset handles ${code}`, async () => {
    const [result] = await linter().lintText(code, {filePath});
    assert.deepEqual(result.messages.map(({messageId}) => messageId), expected);
  });
}

for (const [header, value, expected] of [
  ["Content-Type", "", "invalidMedia"],
  ["Content-Type", "garbage", "invalidMedia"],
  ["Content-Type", "text/", "invalidMedia"],
  ["Content-Type", "te xt/plain", "invalidMedia"],
  ["Content-Type", "text/plain; charset=utf-8", null],
  ["X-Content-Type-Options", "sniff", "nosniff"],
  ["x-content-type-options", "", "nosniff"],
  ["X-Content-Type-Options", "NoSnIfF", null],
  ["X-Content-Type-Options", "nosniff, sniff", "nosniff"],
]) {
  for (const code of [
    ...["set", "append", "setHeader"].map(method => `declare const h: any; h.${method}(${JSON.stringify(header)}, ${JSON.stringify(value)});`),
    `new Response("body", {headers: {${JSON.stringify(header)}: ${JSON.stringify(value)}}});`,
    `declare const h: any; h.writeHead(200, {${JSON.stringify(header)}: ${JSON.stringify(value)}});`,
  ]) {
    test(`recommended preset checks ${code}`, async () => {
      const [result] = await linter().lintText(code, {filePath: "deletion.ts"});
      assert.deepEqual(result.messages.map(({messageId}) => messageId), expected ? [expected] : []);
    });
  }
}

test("dynamic nosniff cannot neutralize the header", async () => {
  const [result] = await linter().lintText('declare const value: string; new Headers().set("X-Content-Type-Options", value);', {filePath: "deletion.ts"});
  assert.deepEqual(result.messages.map(({messageId}) => messageId), ["nosniff"]);
});
