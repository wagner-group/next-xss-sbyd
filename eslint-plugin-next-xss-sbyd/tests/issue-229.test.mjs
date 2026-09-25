import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {cp, mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import test from "node:test";
import {ESLint} from "eslint";
import plugin from "../dist/index.js";

const fixtures = fileURLToPath(new URL("./fixtures", import.meta.url));
const config = [...plugin.configs.recommended, {rules: {"xss-sbyd/require-safe-route-handler": "off"}}];
const imports = 'import {passiveResponse, type PassiveResponse} from "next-xss-sbyd/route-handler";';

test("checked response brands survive helper returns, promises, aliases and let assignments", async () => {
  const eslint = new ESLint({cwd: fixtures, overrideConfigFile: true, overrideConfig: config});
  for (const code of [
    'export function GET() { let response = passiveResponse(Response.json({ok: true})); return response; }',
    'function checked(): PassiveResponse { return passiveResponse(Response.json({ok: true})); } export const GET = () => checked();',
    'async function checked(): Promise<PassiveResponse> { return passiveResponse(await fetch("https://example.test")); } export const GET = () => checked();',
    'function checked() { return passiveResponse(Response.json({ok: true})); } export async function GET() { return await checked(); }',
    'import type {SafeHtml} from "next-xss-sbyd"; type ExtendedHtml = SafeHtml & {tag: string}; declare const html: ExtendedHtml; const accepted = html as SafeHtml;',
    'type Alias = PassiveResponse; declare const checked: Alias; export const GET = () => checked;',
    'type Alias = Pick<PassiveResponse, keyof PassiveResponse>; declare const checked: Alias; export const GET = () => checked;',
    'import type {PassiveResponse as Enforced} from "next-xss-sbyd/enforce"; declare const checked: Enforced; export const GET = () => checked;',
  ]) {
    const [result] = await eslint.lintText(imports + code, {filePath: "app/route.ts"});
    assert.deepEqual(result.messages, [], code);
  }
});

test("mapped declarations with required package brand properties remain outside forgery detection", async () => {
  const eslint = new ESLint({cwd: fixtures, overrideConfigFile: true, overrideConfig: config});
  for (const brand of [
    "{readonly [K in keyof PassiveResponse as K extends symbol ? K : never]: true}",
    "{[K in keyof PassiveResponse]: unknown}",
  ]) {
    const [result] = await eslint.lintText(imports + `type Declared = Response & ${brand}; declare const response: Declared; export const GET = () => response; const asserted = response as PassiveResponse;`, {filePath: "app/route.ts"});
    assert.deepEqual(result.messages, [], brand);
  }
});

test("unchecked unions, erased types, clones and consumer response brands still report", async () => {
  const eslint = new ESLint({cwd: fixtures, overrideConfigFile: true, overrideConfig: config});
  for (const code of [
    imports + 'declare const response: Response & Partial<PassiveResponse>; export const GET = () => response;',
    imports + 'declare const response: PassiveResponse | Response; export const GET = () => response;',
    imports + 'function checked(): Response { return passiveResponse(Response.json({ok: true})); } export const GET = () => checked();',
    imports + 'export const GET = () => passiveResponse(Response.json({ok: true})).clone();',
    'declare const passiveResponseBrand: unique symbol; interface PassiveResponse extends Response {readonly [passiveResponseBrand]: true} declare const response: PassiveResponse; export const GET = () => response;',
  ]) {
    const [result] = await eslint.lintText(code, {filePath: "app/route.ts"});
    assert.deepEqual(result.messages.map(({messageId}) => messageId), ["uncheckedResponse"], code);
  }
});

test("PassiveResponse cannot be forged with casts or any assignments", async () => {
  const eslint = new ESLint({cwd: fixtures, overrideConfigFile: true, overrideConfig: config});
  for (const [code, expected] of [
    ['declare const response: Response; const forged = response as PassiveResponse;', 'cast'],
    ['declare const response: unknown; const forged = response as PassiveResponse;', 'cast'],
    ['declare const response: PassiveResponse | undefined; const forged = response as PassiveResponse;', 'cast'],
    ['declare const response: PassiveResponse | Response; const forged = response as PassiveResponse;', 'cast'],
    ['declare const response: any; const forged: PassiveResponse = response;', 'any'],
    ['declare const response: any; function checked(): PassiveResponse { return response; }', 'any'],
    ['declare const response: any; declare function consume(response: PassiveResponse): void; consume(response);', 'any'],
  ]) {
    const [result] = await eslint.lintText(imports + code, {filePath: "app/route.ts"});
    assert.deepEqual(result.messages.map(({messageId}) => messageId), [expected], code);
  }
});

test("union assertions require every alternative to carry the brand", async () => {
  const eslint = new ESLint({cwd: fixtures, overrideConfigFile: true, overrideConfig: config});
  for (const source of ["SafeHtml | string", "SafeHtml | null"]) {
    const [result] = await eslint.lintText(`import type {SafeHtml} from "next-xss-sbyd"; declare const value: ${source}; const checked = value as SafeHtml;`, {filePath: "app/route.ts"});
    assert.deepEqual(result.messages.map(({messageId}) => messageId), ["cast"], source);
  }
  const [result] = await eslint.lintText('import type {SafeHtml} from "next-xss-sbyd"; declare const value: SafeHtml | null; const checked = value!;', {filePath: "app/route.ts"});
  assert.deepEqual(result.messages, []);
});

test("optional stream brands cannot be asserted into required stream brands", async () => {
  const eslint = new ESLint({cwd: fixtures, overrideConfigFile: true, overrideConfig: config});
  for (const brand of ["SafeStream", "SafeNodeStream"]) {
    const [result] = await eslint.lintText(`import type {${brand}} from "next-xss-sbyd/render"; declare const value: Partial<${brand}>; const checked = value as ${brand};`, {filePath: "app/route.ts"});
    assert.deepEqual(result.messages.map(({messageId}) => messageId), ["cast"], brand);
  }
});

// A filesystem read failure after the existence check depends on OS permissions or a race.
// Reaching the filesystem root without a manifest is impossible for these projects
// under the repository package.json. Neither case is simulated with test doubles.
async function relocatedProject(t) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  await mkdir(join(root, "tmp"), {recursive: true});
  const project = await mkdtemp(join(root, "tmp", "passive-workspace-"));
  t.after(() => rm(project, {recursive: true, force: true}));
  await mkdir(join(project, "app"));
  await cp(join(root, "packages/next-xss-sbyd/dist"), join(project, "libraries/security/dist"), {recursive: true});
  await writeFile(join(project, "libraries/security/dist/package.json"), JSON.stringify({type: "module"}));
  await writeFile(join(project, "libraries/security/package.json"), JSON.stringify({name: "next-xss-sbyd", type: "module"}));
  await writeFile(join(project, "package.json"), JSON.stringify({name: "consumer", type: "module"}));
  await writeFile(join(project, "tsconfig.json"), JSON.stringify({compilerOptions: {target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, jsxImportSource: "next-xss-sbyd"}, include: ["app/*.ts", "middleware.ts"]}));
  const route = join(project, "app/route.ts");
  await writeFile(route, 'import {passiveResponse} from "../libraries/security/dist/route-handler.js"; function checked() { return passiveResponse(Response.json({ok: true})); } export const GET = () => checked();');
  const eslint = new ESLint({cwd: project, overrideConfigFile: true, overrideConfig: config.map((entry) => entry.languageOptions ? {
    ...entry, languageOptions: {...entry.languageOptions, parserOptions: {...entry.languageOptions.parserOptions, tsconfigRootDir: project}},
  } : entry)});
  return {root, project, route, eslint};
}

test("relocated workspace declarations retain the brand through nameless manifests", async (t) => {
  const {route, eslint} = await relocatedProject(t);
  const [result] = await eslint.lintFiles([route]);
  assert.deepEqual(result.messages, []);
});

test("relocated consumer declarations cannot forge package brands", async (t) => {
  const {route, eslint} = await relocatedProject(t);
  const [result] = await eslint.lintText('declare const passiveResponseBrand: unique symbol; interface PassiveResponse extends Response {readonly [passiveResponseBrand]: true} declare const response: PassiveResponse; export const GET = () => response;', {filePath: route});
  assert.deepEqual(result.messages.map(({messageId}) => messageId), ["uncheckedResponse"]);
});

for (const [directory, manifest] of [["malformed", "{"], ["unrelated", JSON.stringify({name: "consumer-types"})]]) {
  test(`${directory} package manifests cannot establish safe brand ownership`, async (t) => {
    const {project, route, eslint} = await relocatedProject(t);
    await mkdir(join(project, "libraries", directory));
    await writeFile(join(project, "libraries", directory, "package.json"), manifest);
    await writeFile(join(project, "libraries", directory, "response.d.ts"), 'declare const passiveResponseBrand: unique symbol; export interface PassiveResponse extends Response {readonly [passiveResponseBrand]: true}');
    const [result] = await eslint.lintText(`import type {PassiveResponse} from "../libraries/${directory}/response.js"; declare const response: PassiveResponse; export const GET = () => response;`, {filePath: route});
    assert.deepEqual(result.messages.map(({messageId}) => messageId), ["uncheckedResponse"]);
  });
}

test("CLI recommended preset accepts checked middleware in relocated workspaces", async (t) => {
  const {root, project} = await relocatedProject(t);
  await writeFile(join(project, "middleware.ts"), 'import {passiveResponse} from "./libraries/security/dist/route-handler.js"; function checked() { return passiveResponse(Response.json({ok: true})); } export function middleware() { let response = checked(); return response; }');
  await writeFile(join(project, "eslint.config.mjs"), `import plugin from ${JSON.stringify(pathToFileURL(join(root, "eslint-plugin-next-xss-sbyd/dist/index.js")).href)}; export default plugin.configs.recommended;`);
  const cli = spawnSync(process.execPath, [join(root, "node_modules/eslint/bin/eslint.js"), "middleware.ts"], {cwd: project, encoding: "utf8"});
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
});
