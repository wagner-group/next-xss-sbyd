import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {ESLint} from "eslint";
import plugin from "../dist/index.js";

const fixtures = fileURLToPath(new URL("./fixtures", import.meta.url));
// Isolate constructor/return diagnostics on deliberately unwrapped handlers.
// route-handler.test.mjs separately checks the required wrapper.
const responseRules = [...plugin.configs.recommended, {rules: {"xss-sbyd/require-safe-route-handler": "off"}}];

test("response lint checks direct, aliased, awaited, and helper-mediated response returns", async () => {
  const eslint = new ESLint({cwd: fixtures, overrideConfigFile: true, overrideConfig: responseRules});
  for (const code of [
    'export async function GET() { return fetch("https://example.test"); }',
    'const handler = () => fetch("https://example.test"); export {handler as GET};',
    'const handler = () => fetch("https://example.test"); export {handler as GET, handler as POST};',
    'const handler = (() => fetch("https://example.test")); export {handler as PUT};',
    'const handler = (() => fetch("https://example.test")) satisfies () => Promise<Response>; export {handler as PATCH};',
    'export const middleware = () => fetch("https://example.test");',
    'export const proxy = () => fetch("https://example.test");',

    'const handler = () => fetch("https://example.test"); const alias = handler; export {alias as POST};',
    'export default function middleware() { try { return fetch("https://example.test"); } catch { return Response.error(); } }',
    'export default () => fetch("https://example.test");',
    'const handler = function () { return fetch("https://example.test"); }; export default handler;',
    'import {SafeResponse} from "next-xss-sbyd"; declare const response: SafeResponse | Response; export const GET = () => response;',

    'export async function GET() { return await fetch("https://example.test"); }',
    'export async function GET() { const response = await fetch("https://example.test"); return response; }',
    'declare function upstream(): Promise<Response>; export const GET = () => upstream();',
    'declare function upstream(): Response; export function GET() { return upstream(); }',
    'export const GET = () => globalThis.fetch("https://example.test");',
    'declare const factory: {[Symbol.iterator](): Response}; export const GET = () => factory[Symbol.iterator]();',
    'declare const response: Response | undefined; export const GET = () => response;',
    'declare const flag: boolean; export const GET = () => flag ? fetch("https://example.test") : Response.json({ok: true});',
    'declare const response: Response; export const GET = () => response.clone();',
    'declare function passiveResponse(response: Response): Response; export async function GET() { return passiveResponse(await fetch("https://example.test")); }',
    'import {upstream} from "./upstream.js"; export const GET = () => upstream();',
    'export async function GET() { let response = await fetch("https://example.test"); return response; }',
  ]) {
    const [result] = await eslint.lintText(code, {filePath: "app/route.ts"});
    assert.deepEqual(result.messages.map(({messageId}) => messageId), ["uncheckedResponse"], code);
  }
  for (const code of [
    'import {passiveResponse} from "next-xss-sbyd/route-handler"; export async function GET() { return passiveResponse(await fetch("https://example.test")); }',
    'import {passiveResponse as check} from "next-xss-sbyd/enforce"; export async function GET() { return check(await fetch("https://example.test")); }',
    'import * as guard from "next-xss-sbyd/enforce"; export async function GET() { return guard.passiveResponse(await fetch("https://example.test")); }',
    'import {SafeResponse, htmlEscape} from "next-xss-sbyd"; export function GET() { return new SafeResponse(htmlEscape("text")); }',
    'export function GET() { return Response.json({ok: true}); }',
    'export async function GET() { const urls = ["https://example.test"]; const responses = await Promise.all(urls.map((u) => fetch(u))); return Response.json(await responses[0].json()); }',
    'export async function GET() { const urls = ["https://example.test"]; const responses = await Promise.all(urls.map(async (u) => { return fetch(u); })); return Response.json(await responses[0].json()); }',
    'async function upstream() { return fetch("https://example.test"); } export async function GET() { return Response.json(await (await upstream()).json()); }',
    'import {SafeResponse, htmlEscape} from "next-xss-sbyd"; function page(): SafeResponse { return new SafeResponse(htmlEscape("x")); } export function GET() { return page(); }',
    'import {SafeNextResponse, htmlEscape} from "next-xss-sbyd"; async function page(): Promise<SafeNextResponse> { return new SafeNextResponse(htmlEscape("x")); } export const GET = () => page();',

    'export function GET() { return; }',
    'export {upstream as GET} from "./upstream.js";',
    'function helper() { return fetch("https://example.test"); }',
    'const callback = () => fetch("https://example.test"); export const config = {runtime: "nodejs"};',

    'declare const partial: {headers: Headers}; export const helper = () => partial;',
    'declare const partial: {headers: Headers; status: number}; export const helper = () => partial;',
    // Unsupported/untyped returns remain for TypeScript or manual review; lint must not crash.
    'declare const responseFactory: Function; export const GET = () => responseFactory();',
    'interface RecursiveThenable {then(callback: (value: RecursiveThenable) => unknown): unknown} declare const recursive: RecursiveThenable; export const GET = () => recursive;',
    'export function GET() { return Response.redirect("https://example.test"); }',
    'import {NextResponse} from "next/server.js"; export const GET = () => NextResponse.next();',
    'import {NextResponse} from "next/server.js"; export const GET = () => NextResponse.rewrite("https://example.test");',
    'import {passiveResponse} from "next-xss-sbyd/enforce"; export async function GET() { const response = passiveResponse(await fetch("https://example.test")); return response; }',
    'export async function GET() { const response = await fetch("https://example.test"); return Response.json(await response.json()); }',
  ]) {
    const [result] = await eslint.lintText(code, {filePath: "app/route.ts"});
    assert.deepEqual(result.messages, [], code);
  }
  const [outside] = await eslint.lintText('export const data = () => fetch("https://example.test"); export function moreData() { return fetch("https://example.test"); }', {filePath: "app/helper.ts"});
  assert.deepEqual(outside.messages, []);
});


test("Node-only projects recognize native static response factories", async () => {
  const eslint = new ESLint({cwd: fixtures, overrideConfigFile: true, overrideConfig: responseRules});
  for (const expression of ['Response.json({ok: true})', 'Response.redirect("https://example.test")', 'Response.error()']) {
    const [result] = await eslint.lintText(`export const GET = () => ${expression};`, {filePath: "node-only/app/route.ts"});
    assert.deepEqual(result.messages, [], expression);
  }
});


test("configured server files check exported boundaries without flagging data callbacks", async () => {
  const eslint = new ESLint({cwd: fixtures, overrideConfigFile: true, overrideConfig: [
    ...plugin.configs.recommended,
    {rules: {"xss-sbyd/no-unsafe-html-response": ["error", {customServerFiles: ["responses.ts"]}]}},
  ]});
  const [unsafe] = await eslint.lintText('export const serve = () => fetch("https://example.test");', {filePath: "responses.ts"});
  assert.deepEqual(unsafe.messages.map(({messageId}) => messageId), ["uncheckedResponse"]);
  const [safe] = await eslint.lintText('export async function serve() { const sources = await Promise.all(["https://example.test"].map((url) => fetch(url))); return Response.json(await sources[0].json()); }', {filePath: "responses.ts"});
  assert.deepEqual(safe.messages, []);
});
