import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {ESLint} from "eslint";
import plugin from "../dist/index.js";

// Issue #222 explicitly requires checking the shipped rule metadata against
// Markdown anchors. Import the built plugin so this also covers RuleCreator.
test("every built rule links to its unique heading in the dedicated rule reference", async () => {
  const entries = Object.entries(plugin.rules);
  assert.ok(entries.length > 0);
  for (const [name, rule] of entries) {
    const url = new URL(rule.meta.docs.url);
    assert.equal(url.origin, "https://github.com");
    assert.equal(url.pathname, "/davidwagner/next-xss-sbyd/blob/main/eslint-plugin-next-xss-sbyd/rules.md");
    assert.equal(url.search, "");
    assert.equal(url.hash, `#${name}`);
    const repoPath = url.pathname.slice("/davidwagner/next-xss-sbyd/blob/main/".length);
    const markdown = await readFile(new URL(`../../${repoPath}`, import.meta.url), "utf8");
    const headings = [...markdown.matchAll(/^## ([a-z][a-z0-9-]*)\s*$/gm)].map(match => match[1]);
    assert.equal(headings.filter(heading => heading === name).length, 1, `${name}: missing or duplicate heading`);
    const section = markdown.split(`## ${name}\n`)[1].split(/^## /m)[0];
    for (const schema of rule.meta.schema) {
      for (const option of Object.keys(schema.properties ?? {})) {
        assert.ok(section.includes(`\`${option}\``) || section.includes(`${option}:`),
          `${name}: missing documentation for option ${option}`);
      }
    }
  }
});

test("real ESLint findings expose the rule reference URL to consumers", async () => {
  const ruleId = "xss-sbyd/no-html-template-strings";
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [{plugins: {"xss-sbyd": plugin}, rules: {[ruleId]: "error"}}],
  });
  const results = await eslint.lintText('const name = "Ada"; const html = `<p>${name}</p>`;', {filePath: "example.js"});
  assert.deepEqual(results[0].messages.map(message => message.ruleId), [ruleId]);
  assert.equal(eslint.getRulesMetaForResults(results)[ruleId].docs.url,
    "https://github.com/davidwagner/next-xss-sbyd/blob/main/eslint-plugin-next-xss-sbyd/rules.md#no-html-template-strings");
});
