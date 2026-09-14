import assert from "node:assert/strict";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {ESLint} from "eslint";
import plugin from "../dist/index.js";

const fixtures = fileURLToPath(new URL("./fixtures", import.meta.url));
const ruleId = "xss-sbyd/no-html-template-strings";

function linter(preset) {
  return new ESLint({
    cwd: fixtures,
    overrideConfigFile: true,
    overrideConfig: [
      ...preset,
      {languageOptions: {parserOptions: {tsconfigRootDir: fixtures, projectService: {allowDefaultProject: ["disable.tsx"]}}}},
    ],
  });
}

test("HTML-looking templates are errors in recommended and warnings during migration", async () => {
  const code = 'const name = "Ada"; const html = `<p>${name}</p>`;';
  for (const [preset, severity] of [[plugin.configs.recommended, 2], [plugin.configs.lintMigration, 1]]) {
    const [result] = await linter(preset).lintText(code, {filePath: "disable.tsx"});
    assert.deepEqual(result.messages.map(({ruleId, severity}) => [ruleId, severity]), [[ruleId, severity]]);
    assert.equal(result.messages[0].fix, undefined);
    assert.equal(result.messages[0].suggestions, undefined);
  }
});

test("reviewed fixtures and non-HTML false positives allow auditable line exemptions", async () => {
  const templates = [
    ['`<img src="${url}" onerror="alert(1)">`', "Intentional hostile input for the sanitizer browser test"],
    ['`<p id="${id}">Highlight seed</p>`', "Benign archive fixture with a test-controlled id"],
    ['`Usage: ${command} <file> [options]`', "CLI help text written only to the terminal, never rendered as HTML"],
  ];
  const eslint = linter(plugin.configs.recommended);
  for (const [template, reason] of templates) {
    const code = `const fixture = ${template};`;
    const [unreviewed] = await eslint.lintText(code, {filePath: "disable.tsx"});
    assert.deepEqual(unreviewed.messages.map(({ruleId, severity}) => [ruleId, severity]), [[ruleId, 2]]);
    const [reviewed] = await eslint.lintText(
      `// eslint-disable-next-line ${ruleId} -- ${reason}\n${code}\nconst other = \`<p>\${value}</p>\`;`,
      {filePath: "disable.tsx"},
    );
    assert.deepEqual(reviewed.messages.map(({ruleId, line, severity}) => [ruleId, line, severity]), [[ruleId, 3, 2]]);
    assert.equal(reviewed.suppressedMessages.length, 1);
    assert.equal(reviewed.suppressedMessages[0].suppressions[0].justification, reason);
  }
  const [unjustified] = await eslint.lintText(
    `// eslint-disable-next-line ${ruleId}\nconst html = \`<p>\${name}</p>\`;`,
    {filePath: "disable.tsx"},
  );
  assert.deepEqual(unjustified.messages.map(({ruleId, severity}) => [ruleId, severity]), [["xss-sbyd/require-disable-justification", 2]]);
});

test("JSX replacements, plain text, and static markup do not trigger the heuristic", async () => {
  const [result] = await linter(plugin.configs.recommended).lintText(
    'const name = "Ada"; const view = <p>{name}</p>; const text = `Hello ${name}`; const staticHtml = `<p>Hello</p>`;',
    {filePath: "disable.tsx"},
  );
  assert.deepEqual(result.messages, []);
});

test("tag exclusions apply only to explicitly configured identifier tags", async () => {
  const eslint = linter([
    ...plugin.configs.recommended,
    {rules: {[ruleId]: ["error", {excludedTags: ["reviewedHtml"]}]}},
  ]);
  const [result] = await eslint.lintText([
    'const allowed = reviewedHtml`<p>${value}</p>`;',
    'const ordinary = html`<p>${value}</p>`;',
    'const member = tags.reviewedHtml`<p>${value}</p>`;',
    'const staticHtml = html`<p>Static</p>`;',
  ].join("\n"), {filePath: "disable.tsx"});
  assert.deepEqual(result.messages.map(({ruleId, line, severity}) => [ruleId, line, severity]), [
    [ruleId, 2, 2],
    [ruleId, 3, 2],
  ]);
});


test("regex lookbehind stays clean without hiding HTML after regex-like prefixes", async () => {
  const eslint = linter(plugin.configs.recommended);
  for (const template of ['`(?<!test.)${extension}`', '`(?<=test.)${extension}`']) {
    const [result] = await eslint.lintText(`const pattern = ${template};`, {filePath: "disable.tsx"});
    assert.deepEqual(result.messages, [], template);
  }
  for (const template of [
    '`<!DOCTYPE html>${value}`', '`<!--${value}-->`', '`<p>${value}</p>`',
    '`x <b${value}`', '`(?<=a)<i>${value}</i>`', '`(?<p>${value}</p>`',
    '`(?<!--${value}-->`', '`(?<!DOCTYPE html>${value}`', '`(?<!test.)<img src="${url}">`',
  ]) {
    const [result] = await eslint.lintText(`const html = ${template};`, {filePath: "disable.tsx"});
    assert.deepEqual(result.messages.map(({ruleId, severity}) => [ruleId, severity]), [[ruleId, 2]], template);
    assert.ok(result.messages[0].message.includes("https://github.com/davidwagner/next-xss-sbyd/blob/main/docs/retrofit.md#resolve-html-template-string-errors"));
  }
});

test("multiline fixtures require exemptions before the opening backtick", async () => {
  const eslint = linter(plugin.configs.recommended);
  const reason = "Intentional multiline hostile input for the sanitizer browser test";
  const directive = `// eslint-disable-next-line ${ruleId} -- ${reason}`;
  const fixture = ['const attack = `', '<img src="${url}" onerror="alert(1)">', '`;'].join("\n");
  const [reviewed] = await eslint.lintText([directive, fixture, 'const other = `<p>${value}</p>`;'].join("\n"), {filePath: "disable.tsx"});
  assert.deepEqual(reviewed.messages.map(({ruleId, line}) => [ruleId, line]), [[ruleId, 5]]);
  assert.equal(reviewed.suppressedMessages[0].suppressions[0].justification, reason);
  const [inside] = await eslint.lintText(['const attack = `', directive, '<img src="${url}" onerror="alert(1)">', '`;'].join("\n"), {filePath: "disable.tsx"});
  assert.deepEqual(inside.messages.map(({ruleId, line}) => [ruleId, line]), [[ruleId, 1]]);
});
