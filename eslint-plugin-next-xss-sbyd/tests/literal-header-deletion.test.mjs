import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";

// Run the actual CLI on a TypeScript project with every recommended rule enabled.
test("recommended preset accepts only provably harmless deletion names", async (t) => {
  const temporaryRoot = fileURLToPath(new URL("../../tmp/", import.meta.url));
  await mkdir(temporaryRoot, {recursive: true});
  const root = await mkdtemp(join(temporaryRoot, "issue-239-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: {strict: true, lib: ["ES2022", "DOM"], jsx: "react-jsx", jsxImportSource: "next-xss-sbyd"}, include: ["*.ts"],
  }));
  const pluginUrl = new URL("../dist/index.js", import.meta.url).href;
  await writeFile(join(root, "eslint.config.mjs"), `import plugin from ${JSON.stringify(pluginUrl)};
export default plugin.configs.recommended.map(entry => entry.languageOptions ? {
  ...entry, languageOptions: {...entry.languageOptions, parserOptions: {
    ...entry.languageOptions.parserOptions, tsconfigRootDir: ${JSON.stringify(root)},
  }},
} : entry);`);
  const lines = [
    'declare const headers: Headers;',
    'enum H { Trace = "X-Trace", CT = "Content-Type" }',
    'declare const flag: boolean;',
    'declare const response: import("node:http").ServerResponse;',
    'const requestId = "X-Request-Id";',
    'declare const tracingHeader: "X-Request-Id" | "X-Trace";',
    'const contentType = "cOnTeNt-TyPe";',
    'declare const options: "X-cOnTeNt-TyPe-OpTiOnS";',
    'declare const mixedContent: "X-Trace" | "CONTENT-TYPE";',
    'declare const mixedOptions: "X-Trace" | "x-content-type-options";',
    'declare const dynamic: string;',
    'declare const untyped: any;',
    'declare const unknown: unknown;',
    'declare const impossible: never;',
    'declare const openTemplate: `X-${string}`;',
    'declare const finiteTemplate: `X-${"Trace" | "Request-Id"}`;',
    'declare const property: {name: "X-Trace" | "X-Request-Id"};',
    'declare const nonStringMember: "X-Trace" | undefined;',
  ];
  const expected = [];
  const cases = [
    ['H.Trace', null], ['H.CT', "remove"],
    ['flag ? "X-Trace" : "X-Request-Id"', null],
    ['flag ? "X-Trace" : "Content-Type"', "remove"],
    ['flag ? "X-Trace" : dynamic', "dynamicRemoval"],
    ['...["Content-Type"]', "dynamicRemoval"],
    ['...["X-Trace"]', "dynamicRemoval"],
    ['dynamic as "X-Trace"', "dynamicRemoval"],
    ['<"X-Request-Id">dynamic', "dynamicRemoval"],
    ['untyped as "X-Trace"', "dynamicRemoval"],
    ['dynamic as unknown as "X-Trace"', "dynamicRemoval"],
    ['"Content-Type" as string', "remove"],
    ['"X-Trace" as string', null],
    ['"Content-Type"', "remove"], ['`X-Content-Type-Options`', "remove"],
    ['"X-Trace"', null], ["requestId", null], ["tracingHeader", null],
    ["finiteTemplate", null], ["property.name", null],
    ["contentType", "remove"], ["options", "remove"],
    ["mixedContent", "remove"], ["mixedOptions", "remove"],
    ["dynamic", "dynamicRemoval"], ["untyped", "dynamicRemoval"],
    ["unknown", "dynamicRemoval"], ["impossible", "dynamicRemoval"],
    ["openTemplate", "dynamicRemoval"], ["unresolvedName", "dynamicRemoval"],
    ["nonStringMember", "dynamicRemoval"],
  ];
  for (const method of ["headers.delete", "headers['delete']", "response.removeHeader"]) {
    for (const [argument, messageId] of cases) {
      lines.push(`${method}(${argument});`);
      if (messageId) expected.push([lines.length, "xss-sbyd/no-html-content-type", messageId]);
    }
  }
  lines.push('new Map<string, string>().delete(contentType);',
    'new Set<string>().delete(mixedOptions);',
    'new Map<string, string>().delete(dynamic);',
    'new Set<string>().delete(untyped);');
  await writeFile(join(root, "headers.ts"), lines.join("\n"));
  const cli = fileURLToPath(new URL("../../node_modules/eslint/bin/eslint.js", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "headers.ts", "--format=json"], {cwd: root, encoding: "utf8"});
  assert.equal(result.status, 1, result.stderr || result.stdout);
  const [report] = JSON.parse(result.stdout);
  assert.deepEqual(report.messages.map(({line, ruleId, messageId}) => [line, ruleId, messageId]), expected);
});
