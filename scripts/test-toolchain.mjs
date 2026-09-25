import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {test} from "node:test";
import semver from "semver";

const require = createRequire(import.meta.url);
const workspace = require("../package.json");
const parserPackage = require("@typescript-eslint/parser/package.json");
const typescript = require("typescript/package.json");

test("TypeScript's installed version and declared range satisfy the parser", () => {
  const supported = parserPackage.peerDependencies.typescript;
  assert.ok(semver.satisfies(typescript.version, supported),
    `TypeScript ${typescript.version} is unsupported by parser ${parserPackage.version}; expected ${supported}`);
  assert.ok(semver.subset(workspace.devDependencies.typescript, supported),
    `TypeScript range ${workspace.devDependencies.typescript} permits versions outside parser support ${supported}`);
});

for (const name of ["eslint", "eslint9"]) {
  test(`${name} satisfies the parser's peer range and lints TypeScript`, async () => {
    const eslintPackage = require(`${name}/package.json`);
    const supported = parserPackage.peerDependencies.eslint;
    assert.ok(semver.satisfies(eslintPackage.version, supported),
      `${name} ${eslintPackage.version} is unsupported by parser ${parserPackage.version}; expected ${supported}`);

    const {ESLint} = await import(name);
    const {default: parser} = await import("@typescript-eslint/parser");
    const linter = new ESLint({
      overrideConfigFile: true,
      overrideConfig: [{
        files: ["**/*.ts"],
        languageOptions: {parser},
        rules: {"no-debugger": "error"},
      }],
    });
    const [clean] = await linter.lintText("export const value: number = 1;", {filePath: "toolchain.ts"});
    assert.deepEqual(clean.messages, []);
    const [invalid] = await linter.lintText("export const value: number = 1; debugger;", {filePath: "toolchain.ts"});
    assert.equal(invalid.fatalErrorCount, 0);
    assert.deepEqual(invalid.messages.map(({ruleId}) => ruleId), ["no-debugger"]);
  });
}
