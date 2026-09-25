import assert from "node:assert/strict";
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {ESLint} from "eslint";
import {ESLint as ESLint9} from "eslint9";
import plugin from "../dist/index.js";

const cases = [
  ['URL.createObjectURL(new Blob());', 1],
  ['URL["createObjectURL"](new Blob());', 1],
  ['URL[`createObjectURL`](new Blob());', 1],
  ['const key = "createObjectURL"; URL[key](new Blob());', 1],
  ['globalThis.URL.createObjectURL(new Blob());', 1],
  ['window.URL.createObjectURL(new Blob());', 1],
  ['self["URL"]["createObjectURL"](new Blob());', 1],
  ['const NativeUrl = URL; NativeUrl.createObjectURL(new Blob());', 1],
  ['const create = URL.createObjectURL; const alias = create; alias(new Blob());', 1],
  ['const {createObjectURL: create} = URL; create(new Blob());', 1],
  ['const {URL: NativeUrl} = window; NativeUrl["createObjectURL"](new Blob());', 1],
  ['let create; create = URL.createObjectURL; create(new Blob());', 1],
  ['(URL.createObjectURL!)(new Blob());', 1],
  ['URL.createObjectURL?.(new Blob());', 1],
  ['const create = URL.createObjectURL.bind(URL); create(new Blob());', 1],
  ['URL.createObjectURL.call(URL, new Blob());', 1],
  ['const create = URL.createObjectURL; create.apply(URL, [new Blob()]);', 1],
  ['function createLater() { const create = URL.createObjectURL; return () => create(new Blob()); }', 1],
  ['const native = URL; function local(URL: {createObjectURL(blob: Blob): string}) { URL.createObjectURL(new Blob()); native.createObjectURL(new Blob()); }', 1],
  ['const user = {createObjectURL(blob: Blob) { return "custom"; }}; user.createObjectURL(new Blob());', 0],
  ['const URL = {createObjectURL(blob: Blob) { return "custom"; }}; const create = URL.createObjectURL; create(new Blob());', 0],
  ['function user(URL: {createObjectURL(blob: Blob): string}) { URL["createObjectURL"](new Blob()); }', 0],
  ['class URL { static createObjectURL(blob: Blob) { return "custom"; } } URL.createObjectURL(new Blob());', 0],
  ['const window = {URL: {createObjectURL(blob: Blob) { return "custom"; }}}; window.URL.createObjectURL(new Blob());', 0],
  ['URL.revokeObjectURL("blob:existing"); new URL("https://example.test");', 0],
  ['function createObjectURL(blob: Blob) { return "custom"; } createObjectURL(new Blob());', 0],
];

for (const [version, Engine] of [[10, ESLint], [9, ESLint9]]) {
  test(`ESLint ${version} recommended preset rejects native object URL calls through real TypeScript bindings`, async (t) => {
    const temporaryRoot = fileURLToPath(new URL("../../tmp/", import.meta.url));
    await mkdir(temporaryRoot, {recursive: true});
    const root = await mkdtemp(join(temporaryRoot, "object-url-lint-"));
    t.after(() => rm(root, {recursive: true, force: true}));
    await writeFile(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: {strict: true, lib: ["ES2022", "DOM"], jsx: "react-jsx", jsxImportSource: "next-xss-sbyd"}, include: ["*.ts"],
    }));
    // The filename deliberately contains the implementation name. Applications
    // must not bypass enforcement by placing code in a similarly named path.
    const filename = "safe-object-url-app.ts";
    await writeFile(join(root, filename), cases.map(([source]) => `{ ${source} }`).join("\n"));
    const eslint = new Engine({cwd: root, overrideConfigFile: true,
      overrideConfig: plugin.configs.recommended.map(entry => entry.languageOptions ? {
        ...entry, languageOptions: {...entry.languageOptions, parserOptions: {
          ...entry.languageOptions.parserOptions, tsconfigRootDir: root,
        }},
      } : entry),
    });
    const [result] = await eslint.lintFiles([filename]);
    const expected = cases.flatMap(([, count], index) => Array.from({length: count}, () => [
      index + 1, "xss-sbyd/no-object-url", "nativeObjectUrl", 2,
    ]));
    assert.deepEqual(result.messages.map(({line, ruleId, messageId, severity}) => [line, ruleId, messageId, severity]), expected);
  });
}
