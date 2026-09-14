import assert from "node:assert/strict";
import {test} from "node:test";
import {ESLint} from "eslint";
import parser from "@typescript-eslint/parser";
import plugin from "../dist/index.js";

const imported = 'import {withSafeRouteHandler} from "next-xss-sbyd/enforce";\n';
async function lint(code, {fix = false, filePath = "app/api/example/route.ts"} = {}) {
  const linter = new ESLint({overrideConfigFile: true, fix, overrideConfig: [{
    files: ["**/*.{ts,js,tsx}"], languageOptions: {parser}, plugins: {"xss-sbyd": plugin},
    rules: {"xss-sbyd/require-safe-route-handler": "error"},
  }]});
  return (await linter.lintText(code, {filePath}))[0];
}

for (const code of [
  `${imported}export const GET = withSafeRouteHandler(() => Response.json({}));`,
  `${imported}export const POST = (withSafeRouteHandler(handler) as Handler) satisfies Handler;`,
  'import {withSafeRouteHandler as safe} from "next-xss-sbyd/enforce"; export const PUT = safe(handler);',
  `${imported}export const dynamic = "force-dynamic"; export const revalidate = 30;`,
  `${imported}export const GET = withSafeRouteHandler(handler), POST = withSafeRouteHandler(other);`,
  'export type {GET} from "./types";',
]) test(`accepts canonical export: ${code}`, async () => {
  assert.deepEqual((await lint(code)).messages, []);
});

for (const code of [
  'export function GET() {return Response.json({});}',
  'export async function POST() {return Response.json({});}',
  'export const GET = handler;',
  'export let GET = handler;',
  'export const GET = unknown(handler);',
  'export const GET = helpers.withSafeRouteHandler(handler);',
  'export const {GET = fallback, ...rest} = handlers;',
  'export const [...GET] = handlers;',
  'export class GET {}',
  `${imported}export let GET = withSafeRouteHandler(handler);`,
  `${imported}export const GET = outer(withSafeRouteHandler(handler));`,
  'export {GET} from "./handlers";',
  'export * from "./handlers";',
  'export const {GET, POST} = handlers;',
  'export const {handlers: {GET}} = source;',
  'export const [GET] = handlers;',
  `${imported}export const GET = withSafeRouteHandler();`,
  `${imported}export const GET = withSafeRouteHandler(...handlers);`,
  'function withSafeRouteHandler(x) {return x;} export const GET = withSafeRouteHandler(fn);',
  'import {withSafeRouteHandler} from "untrusted"; export const GET = withSafeRouteHandler(fn);',
  'import type {withSafeRouteHandler} from "next-xss-sbyd/enforce"; export const GET = withSafeRouteHandler(fn);',
  'import {type withSafeRouteHandler} from "next-xss-sbyd/enforce"; export const GET = withSafeRouteHandler(fn);',
  `${imported}const alias = withSafeRouteHandler; export const GET = alias(fn);`,
]) test(`rejects uncovered export: ${code}`, async () => {
  const result = await lint(code);
  assert(result.messages.length > 0);
  assert(result.messages.every((message) => message.messageId === "wrapper"), JSON.stringify(result.messages));
});

test("ignores non-route files and Pages API exports", async () => {
  for (const filePath of ["app/api/example/helper.ts", "pages/api/route.ts", "lib/route.ts"]) {
    assert.deepEqual((await lint("export function GET() {}", {filePath})).messages, []);
  }
});

test("autofixes simple function and const exports and preserves TypeScript", async () => {
  for (const code of [
    'export async function GET(request: Request): Promise<Response> {return Response.json({});}',
    'export const GET = handler;',
    'export const GET = (first, second);',
    'export const GET: Handler = handler;',
    'const withSafeRouteHandler = 1; export const POST = async () => Response.json({});',
    `${imported}export const GET = handler; export const POST = other;`,
    '"use server";\nexport function GET() {return Response.json({});}',
  ]) {
    const result = await lint(code, {fix: true});
    assert.deepEqual(result.messages, [], result.output);
    assert(result.output.includes("withSafeRouteHandler"));
    assert.deepEqual((await lint(result.output)).messages, []);
  }
});

test("does not autofix destructuring, re-exports, mutable exports or hoisting dependencies", async () => {
  for (const code of [
    'export const {GET, POST} = handlers;',
    'export {GET} from "./handlers";',
    'export * from "./handlers";',
    'export let GET = handler;',
    'GET(); export function GET() {return Response.json({});}',
    'export const GET = handler, unrelated = work();',
  ]) assert.equal((await lint(code, {fix: true})).output, undefined, code);
});

test("recommended configuration requires wrappers", () => {
  assert.equal(plugin.configs.recommended.find((entry) => entry.rules).rules["xss-sbyd/require-safe-route-handler"], "error");
});

test("autofix preserves comma expression evaluation and selects the final handler", async () => {
  const result = await lint("export const GET = (first, second);", {fix: true});
  const executable = result.output.replace(/^import .*;\n/u, "").replace("export const GET", "const GET");
  const first = () => "first";
  const second = () => "second";
  const execute = new Function("withSafeRouteHandler", "first", "second", `${executable}; return GET();`);
  const {withSafeRouteHandler} = await import("next-xss-sbyd/enforce");
  // Real wrapper requires Response values: use the same selection scenario with real handlers.
  const selected = await execute(withSafeRouteHandler, () => Response.json(first()), () => Response.json(second()));
  assert.equal(await selected.json(), "second");
});


test("accepts immutable same-module wrapped exports and the portable subpath", async () => {
  for (const code of [
    `${imported}const GET = withSafeRouteHandler(fn); export {GET};`,
    `${imported}const handler = withSafeRouteHandler(fn); export {handler as GET};`,
    'import {withSafeRouteHandler} from "next-xss-sbyd/route-handler"; export const GET = withSafeRouteHandler(fn);',
  ]) assert.deepEqual((await lint(code)).messages, []);
  for (const code of [
    `${imported}let GET = withSafeRouteHandler(fn); export {GET};`,
    `${imported}const GET = fn; export {GET};`,
  ]) assert.equal((await lint(code)).errorCount, 1);
});

test("autofix leaves overloaded functions intact", async () => {
  const code = 'export function GET(): Response; export function GET(x?: unknown) {return Response.json({});}';
  const result = await lint(code, {fix:true});
  assert.equal(result.output, undefined);
  assert.equal(result.errorCount, 2);
});


test("recommended preset checks migrated Next 16 route files", async () => {
  const {readFile} = await import("node:fs/promises");
  const linter = new ESLint({overrideConfigFile:true, overrideConfig:plugin.configs.recommended});
  const results = await linter.lintFiles(["fixtures/next16/app/**/route.{ts,tsx}"]);
  assert(results.length >= 9);
  for (const result of results) {
    assert.equal(result.fatalErrorCount, 0, JSON.stringify(result.messages));
    assert.equal(result.messages.filter(message => message.ruleId === "xss-sbyd/require-safe-route-handler").length, 0, result.filePath);
  }
  // Exercise migration with a real fixture body, including its TypeScript syntax.
  const filename = "fixtures/next16/app/api/article/route.ts";
  const current = await readFile(filename, "utf8");
  const before = current.replace(/^import \{withSafeRouteHandler\}.*\n/mu, "")
    .replace("export const GET = withSafeRouteHandler(async function GET", "export async function GET")
    .replace(/\}\);\s*$/u, "}\n");
  assert.equal((await lint(before, {filePath:filename})).errorCount, 1);
  const fixed = await lint(before, {filePath:filename, fix:true});
  assert.equal(fixed.errorCount, 0);
  assert.equal((await linter.lintText(fixed.output, {filePath:filename}))[0].messages
    .filter(message => message.ruleId === "xss-sbyd/require-safe-route-handler").length, 0);
});
