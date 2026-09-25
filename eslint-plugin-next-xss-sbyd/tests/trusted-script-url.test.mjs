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
    overrideConfig: [{
      files: ["**/*.tsx"],
      languageOptions: {parser, parserOptions: {project: "./tsconfig.json", tsconfigRootDir: fixtures}},
      plugins: {"xss-sbyd": plugin},
      rules: {
        "xss-sbyd/safe-jsx-urls-active": "error",
        "xss-sbyd/no-unsafe-cast-to-safe-type": "error",
      },
    }],
  });
}

test("ESLint accepts new, aliased, legacy, and upstream trusted script values", async () => {
  const [result] = await linter().lintText(`
    import {trustedScriptUrl, trustedResourceUrl} from "next-xss-sbyd";
    import type {TrustedScriptUrl as Renamed, TrustedResourceUrl} from "next-xss-sbyd";
    import {trustedResourceUrl as upstream} from "safevalues";
    const renamed: Renamed = trustedScriptUrl\`/app.js\`;
    const legacy: TrustedResourceUrl = trustedResourceUrl\`/legacy.js\`;
    export const content = <>
      <script src={renamed} /><script {...{src: renamed}} />
      <iframe src={renamed} /><link rel="stylesheet" href={renamed} />
      <svg><use href={renamed} /></svg>
      <script src={legacy} /><script src={upstream\`/upstream.js\`} />
    </>;
  `, {filePath: "app/valid.tsx"});
  assert.deepEqual(result.messages, []);
});

test("ESLint rejects unsafe flows with TrustedScriptUrl diagnostics", async () => {
  const [result] = await linter().lintText(`
    import type {TrustedScriptUrl as Renamed, TrustedResourceUrl} from "next-xss-sbyd";
    declare const raw: string;
    declare const unchecked: any;
    const cast = raw as Renamed;
    const legacyCast = raw as TrustedResourceUrl;
    const bypass: Renamed = unchecked;
    export const content = <script src={raw} />;
  `, {filePath: "app/valid.tsx"});
  assert.deepEqual(result.messages.map(({messageId}) => messageId), ["cast", "cast", "any", "active"]);
  for (const message of result.messages.filter(({messageId}) => messageId !== "any")) {
    assert.match(message.message, /TrustedScriptUrl/u);
  }
});
