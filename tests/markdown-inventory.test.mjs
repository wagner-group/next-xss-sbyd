import assert from "node:assert/strict";
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {spawnSync} from "node:child_process";
import test from "node:test";
import {inventoryMarkdown} from "../packages/next-xss-sbyd/dist/inventory.js";
import {discoverProject} from "../packages/next-xss-sbyd/dist/project.js";
import {checkLint} from "../packages/next-xss-sbyd/dist/config-check.js";
import {runAudit} from "../packages/next-xss-sbyd/dist/audit.js";

const root = fileURLToPath(new URL("../", import.meta.url));
async function project(t) {
  await mkdir(join(root, "tmp"), {recursive: true});
  const directory = await mkdtemp(join(root, "tmp/markdown-inventory-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  await writeFile(join(directory, "package.json"), JSON.stringify({type: "module", "next-xss-sbyd": {markdown: true}}));
  await writeFile(join(directory, "article.md"), "# Plain Markdown");
  await writeFile(join(directory, "article.mdx"), "export const value = runCode();");
  await writeFile(join(directory, "article.tsx"), 'import Markdown from "react-markdown"; import {evaluate} from "@mdx-js/mdx"; const options = {rehypePlugins: [rehypeRaw]}; const element = <CustomMarkdown />; import(target);');
  await writeFile(join(directory, "eslint.config.mjs"), `import plugin from ${JSON.stringify(pathToFileURL(join(root, "eslint-plugin-next-xss-sbyd/dist/index.js")).href)}; export default plugin.configs.markdownMigration;`);
  return directory;
}

test("inventory discovers documents and pipeline sites and reports MDX coverage honestly", async (t) => {
  const directory = await project(t);
  const items = await inventoryMarkdown(directory);
  assert.equal(items.filter((item) => item.category === "document").length, 2);
  assert.match(items.find((item) => item.file === "article.mdx").detail, /not analyzed/);
  for (const category of ["renderer-or-pipeline", "configuration", "unknown-wrapper", "coverage"]) assert.ok(items.some((item) => item.category === category), category);
  const cli = spawnSync(process.execPath, [join(root, "packages/next-xss-sbyd/dist/inventory.js"), directory, "--markdown", "--json"], {encoding: "utf8"});
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(JSON.parse(cli.stdout), items);
});

test("Markdown findings and unresolved loader coverage reach real audit output", async (t) => {
  const directory = await project(t);
  const result = await runAudit(await discoverProject(directory), {recommended: false});
  assert.ok(result.findings.some((item) => item.category === "markdown-renderer"), JSON.stringify(result));
  assert.ok(result.findings.some((item) => item.category === "mdx-execution"));
  assert.ok(result.findings.some((item) => item.category === "coverage"));
  assert.ok(result.diagnostics.some((item) => item.id === "audit.markdown-inventory" && item.evidence.includes("article.mdx")));
});

test("configuration checking rejects disabled Markdown rules when the preset is selected", async (t) => {
  const directory = await project(t);
  const configPath = join(directory, "eslint.config.mjs");
  await writeFile(configPath, `import plugin from ${JSON.stringify(pathToFileURL(join(root, "eslint-plugin-next-xss-sbyd/dist/index.js")).href)}; export default [...plugin.configs.markdownMigration, {rules: {"xss-sbyd/no-danger": "warn", "xss-sbyd/require-safe-markdown": "off"}}];`);
  const diagnostics = await checkLint(await discoverProject(directory), "lint");
  assert.ok(diagnostics.some((item) => item.id === "eslint.preset-weakened" && item.evidence.includes("require-safe-markdown")), JSON.stringify(diagnostics));
});

test("configuration checking accepts the selected Markdown severity contract", async (t) => {
  const directory = await project(t);
  await writeFile(join(directory, "eslint.config.mjs"), `import plugin from ${JSON.stringify(pathToFileURL(join(root, "eslint-plugin-next-xss-sbyd/dist/index.js")).href)}; export default [...plugin.configs.lintMigration, ...plugin.configs.markdownMigration];`);
  const diagnostics = await checkLint(await discoverProject(directory), "lint");
  assert.ok(diagnostics.some((item) => item.id === "eslint.effective"), JSON.stringify(diagnostics));
});

test("audit exposes justified Markdown adapter exceptions", async (t) => {
  const directory = await project(t);
  await writeFile(join(directory, "article.tsx"), '/* eslint-disable xss-sbyd/require-safe-markdown -- owner: security; fixed adapter; covered by adapter.test */\nimport Markdown from "react-markdown";');
  const result = await runAudit(await discoverProject(directory), {recommended: false});
  assert.ok(result.findings.some((item) => item.category === "markdown-renderer" && item.suppressed));
  assert.ok(result.exemptions.some((item) => item.justification?.includes("owner: security")));
});

test("inventory ignores safe APIs, unrelated options and TypeScript generic arguments", async (t) => {
  const directory = await project(t);
  await writeFile(join(directory, "article.tsx"), `
    app.use(router);
    const options = {overrides: {}};
    const safe = <SafeMarkdown>hello</SafeMarkdown>;
    const namespaced = <Security.SafeMarkdown />;
    const block = <SafeBlock>{sanitizeUserHtml(html)}</SafeBlock>;
    type Nodes = Array<MarkdownNode>;
    type SpacedNodes = Array <MarkdownNode>;
  `);
  const items = await inventoryMarkdown(directory);
  assert.deepEqual(items.filter((item) => item.file === "article.tsx"), []);
  await writeFile(join(directory, "article.tsx"), `
    const wrapper = <CustomMarkdown>hello</CustomMarkdown>;
    const mdx = <MDXContent />;
    const unsafe = {dangerouslySetInnerHTML: {__html: html}};
    import {bundleMDX} from "mdx-bundler";
    import {MDXRemote} from "next-mdx-remote-client/rsc";
  `);
  const candidates = (await inventoryMarkdown(directory)).filter((item) => item.file === "article.tsx");
  assert.equal(candidates.filter((item) => item.category === "unknown-wrapper").length, 2);
  assert.equal(candidates.filter((item) => item.category === "html-sink").length, 1);
  assert.equal(candidates.filter((item) => item.category === "renderer-or-pipeline").length, 2);
});

test("audit does not add Markdown inventory warnings without the package opt-in", async (t) => {
  const directory = await project(t);
  await writeFile(join(directory, "package.json"), JSON.stringify({type: "module"}));
  await writeFile(join(directory, "article.tsx"), 'export const greeting = "hello";');
  const result = await runAudit(await discoverProject(directory), {recommended: false});
  assert.equal(result.diagnostics.some((item) => item.id === "audit.markdown-inventory"), false);
  assert.ok((await inventoryMarkdown(directory)).some((item) => item.category === "document"));
});

test("strict config keeps loader coverage at warning and rejects disabled coverage", async (t) => {
  const directory = await project(t);
  const configPath = join(directory, "eslint.config.mjs");
  const presets = `import plugin from ${JSON.stringify(pathToFileURL(join(root, "eslint-plugin-next-xss-sbyd/dist/index.js")).href)}; export default [...plugin.configs.recommended, ...plugin.configs.markdown`;
  await writeFile(configPath, `${presets}];`);
  const accepted = await checkLint(await discoverProject(directory), "enforce");
  assert.ok(accepted.some((item) => item.id === "eslint.effective"), JSON.stringify(accepted));
  await writeFile(configPath, `${presets}, {rules: {"xss-sbyd/markdown-loader-coverage": "off"}}];`);
  const rejected = await checkLint(await discoverProject(directory), "enforce");
  assert.ok(rejected.some((item) => item.id === "eslint.preset-weakened" && item.evidence.includes("markdown-loader-coverage")), JSON.stringify(rejected));
});

test("config checking diagnoses missing plugin through the existing base stage check", async (t) => {
  const directory = await project(t);
  await writeFile(join(directory, "eslint.config.mjs"), 'export default [{files: ["**/*.{js,ts,tsx,mjs}"]}];');
  const diagnostics = await checkLint(await discoverProject(directory), "lint");
  assert.ok(diagnostics.some((item) => item.id === "eslint.preset-stage"));
  assert.equal(diagnostics.some((item) => item.id === "eslint.preset-weakened"), false);
});
