import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";

const formatter = resolve("scripts/sort-package-manifests.mjs");
const tsc = resolve("node_modules/typescript/bin/tsc");

function temporaryProject(t) {
  mkdirSync("tmp", {recursive: true});
  const directory = mkdtempSync(resolve("tmp/merge-maintenance-"));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  return directory;
}

function run(cwd, args) {
  const result = spawnSync(process.execPath, args, {cwd, encoding: "utf8"});
  assert.ifError(result.error);
  return result;
}

function writeManifest(directory, manifest) {
  mkdirSync(directory, {recursive: true});
  writeFileSync(resolve(directory, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
}

test("manifest CLI detects drift without writing, formats both manifests, and is idempotent", (t) => {
  const directory = temporaryProject(t);
  const manifest = {
    name: "maintenance-example", type: "module",
    scripts: {z: "node z.mjs", a: "node a.mjs"},
    dependencies: {z: "1.0.0", a: "2.0.0"},
    devDependencies: {z: "1.0.0", a: "2.0.0"},
    peerDependencies: {z: "1.0.0", a: "2.0.0"},
    peerDependenciesMeta: {z: {optional: true}, a: {optional: true}},
    optionalDependencies: {z: "1.0.0", a: "2.0.0"},
    exports: {"./z": "./z.mjs", ".": {node: "./node.mjs", default: "./default.mjs"}},
    files: ["z", "a"],
  };
  const paths = [directory, resolve(directory, "packages/next-xss-sbyd")];
  for (const path of paths) writeManifest(path, manifest);
  const before = readFileSync(resolve(directory, "package.json"), "utf8");
  const check = run(directory, [formatter, "--check"]);
  assert.equal(check.status, 1, check.stderr);
  assert.match(check.stderr, /npm run format:manifests/);
  for (const path of paths) assert.equal(readFileSync(resolve(path, "package.json"), "utf8"), before);
  assert.equal(run(directory, [formatter]).status, 0);
  for (const path of paths) {
    const actual = JSON.parse(readFileSync(resolve(path, "package.json"), "utf8"));
    assert.deepEqual(actual, manifest, "Formatting must preserve every manifest value");
    for (const field of ["scripts", "dependencies", "devDependencies", "peerDependencies", "peerDependenciesMeta", "optionalDependencies", "exports"]) {
      assert.deepEqual(Object.keys(actual[field]), Object.keys(manifest[field]).sort(), field);
    }
  }
  const formatted = readFileSync(resolve(directory, "package.json"), "utf8");
  assert.equal(run(directory, [formatter, "--check"]).status, 0);
  assert.equal(run(directory, [formatter]).status, 0);
  assert.equal(readFileSync(resolve(directory, "package.json"), "utf8"), formatted);
});

test("formatting preserves Node's ordered and nested conditional export selection", (t) => {
  const directory = temporaryProject(t);
  writeManifest(resolve(directory, "packages/next-xss-sbyd"), {exports: null});
  for (const name of ["server", "node", "default", "subpath", "edge", "browser"]) {
    writeFileSync(resolve(directory, `${name}.mjs`), `export default ${JSON.stringify(name)};\n`);
  }
  const conditions = {"react-server": {node: "./server.mjs", default: "./default.mjs"}, "edge-light": "./edge.mjs", browser: "./browser.mjs", node: "./node.mjs", default: "./default.mjs"};
  for (const exports of [{"./z": "./subpath.mjs", ".": conditions}, conditions, "./node.mjs", ["./node.mjs"]]) {
    writeManifest(directory, {name: "maintenance-example", type: "module", exports});
    const selections = [
      [[], "node"],
      [["--conditions=browser"], "browser"],
      [["--conditions=browser", "--conditions=edge-light"], "edge"],
      [["--conditions=browser", "--conditions=edge-light", "--conditions=react-server"], "server"],
    ];
    for (const [flags, expected] of selections) {
      const command = [...flags, "--input-type=module", "-e", "import value from 'maintenance-example'; console.log(value)"];
      const before = run(directory, command);
      assert.equal(before.status, 0, before.stderr);
      assert.equal(before.stdout.trim(), typeof exports === "string" || Array.isArray(exports) ? "node" : expected);
      assert.equal(run(directory, [formatter]).status, 0);
      const after = run(directory, command);
      assert.equal(after.status, 0, after.stderr);
      assert.equal(after.stdout, before.stdout, "Node export condition precedence changed after formatting; never sort condition keys");
    }
  }
});

test("manifest CLI rejects unsupported arguments", (t) => {
  const directory = temporaryProject(t);
  for (const args of [["--write"], ["--check", "--check"]]) {
    const result = run(directory, [formatter, ...args]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
  }
});

test("TypeScript discovers new root fixtures and excludes intentional failures in fail/", (t) => {
  const directory = temporaryProject(t);
  copyFileSync("type-fixtures/tsconfig.json", resolve(directory, "tsconfig.json"));
  // Existing names let this reproduce the old explicit-list omission before the fix.
  for (const name of ["pass.ts", "pass-jsx.tsx", "pass-playwright.ts", "object-url.tsx"]) {
    writeFileSync(resolve(directory, name), "export {};\n");
  }
  mkdirSync(resolve(directory, "fail"));
  writeFileSync(resolve(directory, "fail/intentional.ts"), "export const value: number = 'invalid';\n");
  writeFileSync(resolve(directory, "new-api.ts"), "export const value: number = 1;\n");
  writeFileSync(resolve(directory, "new-component.tsx"), "export const value: string = 'valid';\n");
  const valid = run(directory, [tsc, "-p", "tsconfig.json"]);
  assert.equal(valid.status, 0, `Passing fixtures must exclude fail/: ${valid.stdout}${valid.stderr}`);
  for (const name of ["new-api.ts", "new-component.tsx"]) {
    writeFileSync(resolve(directory, name), "export const value: number = 'invalid';\n");
  }
  const invalid = run(directory, [tsc, "-p", "tsconfig.json"]);
  assert.equal(invalid.status, 2, "TypeScript stopped discovering new root fixtures; security API examples could silently escape compilation");
  for (const name of ["new-api.ts", "new-component.tsx"]) assert.ok(invalid.stdout.includes(name), `Missing TypeScript diagnostic for ${name}`);
  assert.ok(!invalid.stdout.includes("fail/intentional"), invalid.stdout);
});
