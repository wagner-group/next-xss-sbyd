import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {test} from "node:test";

const root = new URL("../", import.meta.url);
const workspaceRequire = createRequire(new URL("packages/next-xss-sbyd/package.json", root));

for (const [directory, dependencyField, lockDirectory] of [
  ["packages/next-xss-sbyd", "devDependencies", "."],
  ["fixtures/next14", "dependencies", "fixtures/next14"],
  ["fixtures/next15", "dependencies", "fixtures/next15"],
  ["fixtures/next16", "dependencies", "fixtures/next16"],
]) {
  test(`${directory}: React and React DOM declarations and lockfile match exactly`, () => {
    const manifest = JSON.parse(readFileSync(new URL(`${directory}/package.json`, root), "utf8"));
    const lock = JSON.parse(readFileSync(new URL(`${lockDirectory}/package-lock.json`, root), "utf8"));
    const dependencies = manifest[dependencyField];
    assert.match(dependencies.react, /^\d+\.\d+\.\d+$/, "Pin React to an exact release");
    assert.equal(dependencies.react, dependencies["react-dom"], "React and React DOM must have the exact same version");
    for (const name of ["react", "react-dom"]) {
      assert.equal(lock.packages[`node_modules/${name}`].version, dependencies[name],
        `${directory}: locked ${name} must match the declared version`);
    }
  });
}

test("installed workspace React and React DOM match and render HTML", () => {
  const react = workspaceRequire("react/package.json");
  const reactDom = workspaceRequire("react-dom/package.json");
  assert.equal(react.version, reactDom.version, "Installed React and React DOM must have the exact same version");
  const manifest = workspaceRequire("./package.json");
  assert.equal(react.version, manifest.devDependencies.react, "Installed React must match the workspace pin");
  const {createElement} = workspaceRequire("react");
  const {renderToStaticMarkup} = workspaceRequire("react-dom/server");
  assert.equal(renderToStaticMarkup(createElement("p", null, "<safe>")), "<p>&lt;safe&gt;</p>");
});
