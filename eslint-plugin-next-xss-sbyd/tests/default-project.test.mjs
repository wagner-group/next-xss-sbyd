import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {relative} from "node:path";
import {describe, test} from "node:test";
import {fileURLToPath} from "node:url";
import {ESLint} from "eslint";
import plugin, {allowDefaultProjectGlobs} from "../dist/index.js";

const fixtures = fileURLToPath(new URL("./fixtures/default-project", import.meta.url));

function recommendedConfig(tsconfigRootDir) {
  return plugin.configs.recommended.map((entry) => entry.languageOptions ? {
    ...entry,
    languageOptions: {
      ...entry.languageOptions,
      parserOptions: {...entry.languageOptions.parserOptions, tsconfigRootDir},
    },
  } : entry);
}

function diagnosticsByFile(results) {
  return Object.fromEntries(results.map((result) => [
    relative(fixtures, result.filePath),
    result.messages.map(({line, column, ruleId, messageId}) => [
      line,
      column,
      ruleId?.replace(/^xss-sbyd\//u, ""),
      messageId,
    ]),
  ]));
}

describe("default-project config files", () => {
  test("type-checks standard root JavaScript config files", async () => {
    assert.deepEqual(plugin.allowDefaultProjectGlobs, ["*.js", "*.mjs", "*.cjs"]);
    assert.equal(allowDefaultProjectGlobs, plugin.allowDefaultProjectGlobs);

    const linter = new ESLint({
      cwd: fixtures,
      overrideConfigFile: true,
      overrideConfig: recommendedConfig(fixtures),
    });
    const results = await linter.lintFiles([
      "eslint.config.mjs",
      "next.config.mjs",
      "postcss.config.cjs",
      "tailwind.config.js",
    ]);

    assert.deepEqual(diagnosticsByFile(results), {
      "eslint.config.mjs": [],
      "next.config.mjs": [
        [3, 42, "no-danger", "danger"],
        [4, 1, "no-danger", "danger"],
        [4, 1, "require-safe-jsx-runtime", "factoryBypass"],
      ],
      "postcss.config.cjs": [],
      "tailwind.config.js": [],
    });
  });

  test("keeps type-aware application checks enabled", async () => {
    const linter = new ESLint({
      cwd: fixtures,
      overrideConfigFile: true,
      overrideConfig: recommendedConfig(fixtures),
    });
    const [result] = await linter.lintFiles(["app/api/vulnerable/route.ts"]);
    assert.ok(result.messages.some(({ruleId}) => (
      ruleId === "xss-sbyd/no-unsafe-html-response"
    )));
  });

  test("fails closed for nested configs unless anchored to their app", async () => {
    const rootLinter = new ESLint({
      cwd: fixtures,
      overrideConfigFile: true,
      overrideConfig: recommendedConfig(fixtures),
    });
    const [rootResult] = await rootLinter.lintFiles(["apps/web/next.config.mjs"]);
    assert.equal(rootResult.fatalErrorCount, 1);
    assert.match(rootResult.messages[0].message, /allowDefaultProject/u);

    const appFixtures = fileURLToPath(new URL("./fixtures/default-project/apps/web", import.meta.url));
    const pluginUrl = new URL("../dist/index.js", import.meta.url).href;
    const script = [
      'import {ESLint} from "eslint";',
      `const plugin = (await import(${JSON.stringify(pluginUrl)})).default;`,
      "const config = plugin.configs.recommended.map((entry) => entry.languageOptions ? {...entry, languageOptions: {...entry.languageOptions, parserOptions: {...entry.languageOptions.parserOptions, tsconfigRootDir: process.cwd()}}} : entry);",
      "const linter = new ESLint({overrideConfigFile: true, overrideConfig: config});",
      'const [result] = await linter.lintFiles(["next.config.mjs"]);',
      "process.stdout.write(JSON.stringify(result.messages));",
    ].join("\n");
    const child = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: appFixtures,
      encoding: "utf8",
    });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), []);
  });
});
