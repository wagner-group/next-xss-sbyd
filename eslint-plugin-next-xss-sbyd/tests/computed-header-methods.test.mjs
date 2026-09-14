import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import test from "node:test";

test("full preset CLI distinguishes read-only method unions from possible header deletion", (t) => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  mkdirSync(new URL("../../tmp/", import.meta.url), {recursive: true});
  const directory = mkdtempSync(`${root}tmp/computed-header-methods-`);
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  writeFileSync(`${directory}/tsconfig.json`, JSON.stringify({compilerOptions: {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
    jsx: "react-jsx", jsxImportSource: "next-xss-sbyd",
  }, include: ["*.ts"]}));
  writeFileSync(`${directory}/eslint.config.mjs`, `
  import plugin from ${JSON.stringify(new URL("../dist/index.js", import.meta.url).href)};
  export default plugin.configs.recommended;
  `);
  const cases = [
    ['', '(() => {})();', false],
    ['declare const method: string;', 'headers[method as "get"]("Content-Type");', true],
    ['declare const method: string;', 'headers[<"get">method]("Content-Type");', true],
    ['declare const method: any;', 'headers[method as "get"]("Content-Type");', true],
    ['declare const method: string;', 'headers[method as unknown as "get"]("Content-Type");', true],
    ['', 'headers["delete" as string]("Content-Type");', true],
    ['', 'headers["get" as string]("Content-Type");', false],
    ['const method = "get";', 'headers[method]("Content-Type");', false],
    ['declare const method: "get" | "has";', 'headers[method]("Content-Type");', false],
    ['declare const method: "get" | "has";', 'headers[method]("X-Content-Type-Options");', false],
    ['declare const method: "get" | "has";', 'headers?.[method]("Content-Type");', false],
    ['const method = "delete";', 'headers[method]("Content-Type");', true],
    ['', 'headers.delete("X-Content-Type-Options");', true],
    ['', 'headers["delete"]("Content-Type");', true],
    ['declare const method: "get" | "delete";', 'headers[method]("Content-Type");', true],
    ['declare const method: "get" | "delete";', 'headers[method]("X-Content-Type-Options");', true],
    ['declare const method: string;', 'headers[method]("Content-Type");', true],
    ['declare const method: any;', 'headers[method]("Content-Type");', true],
    ['declare const method: "get" | number;', 'headers[method]("Content-Type");', true],
    ['declare const method: never;', 'headers[method]("Content-Type");', true],
    ['declare const method: symbol;', 'headers[method]("Content-Type");', true],
    ['declare const receiver: any;', 'receiver.delete("Content-Type");', true],
    ['declare const receiver: any; declare const method: string;', 'receiver[method]("Content-Type");', true],
    ['declare const receiver: any; declare const method: "get" | "delete";', 'receiver[method]("Content-Type");', true],
    ['declare const receiver: import("node:http").ServerResponse; declare const method: "getHeader" | "removeHeader";', 'receiver[method]("Content-Type");', true],
    ['declare const receiver: import("node:http").ServerResponse; declare const method: "getHeader" | "hasHeader";', 'receiver[method]("Content-Type");', false],
    ['declare const receiver: Map<string, string>; declare const method: "get" | "delete";', 'receiver[method]("Content-Type");', false],
    ['declare const method: "get" | "delete";', 'headers[method]("X-Request-Id");', false],
  ];
  const expected = new Map();
  for (const [index, [declaration, call, finding]] of cases.entries()) {
    const path = `${directory}/case-${index}.ts`;
    writeFileSync(path, `export {}; const headers = new Headers(); ${declaration}\n${call}\n`);
    expected.set(path, finding ? [["xss-sbyd/no-html-content-type", "remove"]] : []);
  }
  let output;
  try {
    output = execFileSync(process.execPath, [`${root}node_modules/eslint/bin/eslint.js`, ".", "--format=json"], {cwd: directory, encoding: "utf8"});
  } catch (error) {
    assert.equal(error.status, 1, error.stderr);
    output = error.stdout;
  }
  const results = JSON.parse(output).filter(result => result.filePath.endsWith(".ts"));
  assert.equal(results.length, cases.length);
  for (const result of results) {
    assert.deepEqual(result.messages.map(({ruleId, messageId}) => [ruleId, messageId]), expected.get(result.filePath), result.filePath);
  }
});
