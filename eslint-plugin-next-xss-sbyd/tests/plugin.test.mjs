import assert from "node:assert/strict";
import {relative} from "node:path";
import {describe, test} from "node:test";
import {fileURLToPath} from "node:url";
import {ESLint} from "eslint";
import plugin from "../dist/index.js";

const fixtures = fileURLToPath(new URL("./fixtures", import.meta.url));

// Each tuple is [line, column, rule name, message ID].
const expectedVulnerableDiagnostics = {
  "app/vulnerable.tsx": [
    [5, 9, "no-raw-render-to-string", "rawRenderer"],
    [5, 35, "no-raw-render-to-string", "rawRenderer"],
    [6, 8, "no-raw-render-to-string", "rawRenderer"],
    [24, 29, "no-unsafe-cast-to-safe-type", "any"],
    [26, 12, "no-unsafe-cast-to-safe-type", "any"],
    [27, 15, "no-unsafe-cast-to-safe-type", "any"],
    [28, 47, "no-unsafe-cast-to-safe-type", "any"],
    [31, 16, "no-html-template-strings", "htmlTemplate"],
    [32, 16, "no-unsafe-cast-to-safe-type", "cast"],
    [33, 19, "no-unsafe-cast-to-safe-type", "cast"],
    [34, 21, "no-unsafe-cast-to-safe-type", "cast"],
    [35, 25, "no-unsafe-cast-to-safe-type", "cast"],
    [40, 10, "no-danger", "danger"],
    [40, 36, "no-danger", "danger"],
    [42, 22, "no-unsafe-cast-to-safe-type", "any"],
    [43, 13, "no-dynamic-script-style", "dynamic"],
    [44, 12, "no-dynamic-script-style", "dynamic"],
    [45, 18, "no-dynamic-script-style", "dynamic"],
    [46, 13, "safe-jsx-urls-active", "active"],
    [47, 13, "safe-jsx-urls-active", "active"],
    [48, 13, "no-dynamic-script-style", "dynamic"],
    [49, 13, "safe-jsx-urls-active", "active"],
    [50, 13, "safe-jsx-urls-active", "active"],
    [51, 28, "safe-jsx-urls-active", "active"],
    [52, 23, "safe-jsx-urls-active", "active"],
    [53, 15, "safe-jsx-urls-active", "active"],
    [54, 11, "safe-jsx-urls-active", "forbidden"],
    [55, 5, "safe-jsx-urls-active", "forbidden"],
    [77, 34, "no-html-content-type", "html"],
    [78, 34, "no-html-content-type", "dynamic"],
    [79, 41, "no-html-content-type", "html"],
  ],
  "app/api/vulnerable/route.ts": [
    [6, 8, "require-safe-route-handler", "wrapper"],
    [8, 34, "no-unsafe-html-response", "unsafe"],
    [9, 39, "no-unsafe-html-response", "rawHtml"],
    [9, 73, "no-html-content-type", "html"],
    [10, 38, "no-unsafe-html-response", "unsafe"],
    [11, 31, "no-unsafe-html-response", "unsafe"],
    [12, 35, "no-unsafe-html-response", "rawHtml"],
    [13, 30, "no-unsafe-html-response", "unsafe"],
    [14, 31, "no-unsafe-html-response", "unsafe"],
    [15, 29, "no-unsafe-html-response", "unsafe"],
    [16, 31, "no-unsafe-html-response", "unsafe"],
  ],
  "pages/api/vulnerable.ts": [
    [3, 1, "require-safe-api-route", "wrapper"],
    [4, 17, "no-unsafe-api-send", "unsafe"],
    [5, 23, "no-unsafe-api-send", "unsafe"],
    [6, 16, "no-unsafe-api-send", "unsafe"],
    [8, 22, "no-unsafe-api-send", "unsafe"],
    [10, 8, "no-unsafe-api-send", "unsafe"],
  ],
};

function diagnosticsByFile(results) {
  return Object.fromEntries(results.map((result) => [
    relative(fixtures, result.filePath),
    result.messages.map(({line, column, ruleId, messageId}) => [line, column, ruleId?.replace(/^xss-sbyd\//u, ""), messageId]),
  ]));
}

function eslint(rules) {
  return new ESLint({
    cwd: fixtures,
    overrideConfigFile: true,
    overrideConfig: [{
      files: ["**/*.{ts,tsx}"],
      languageOptions: {
        parser: plugin.configs.recommended[1].languageOptions.parser,
        parserOptions: {projectService: {allowDefaultProject: ["disable.ts", "disable.tsx"]}, tsconfigRootDir: fixtures, ecmaFeatures: {jsx: true}},
      },
      plugins: {"xss-sbyd": plugin},
      rules,
    }],
  });
}

describe("recommended preset", () => {
  test("rejects any flowing into safe brands before it reaches a sink", async () => {
    const code = [
      'import type {SafeHtml} from "next-xss-sbyd";',
      "declare const value: any;",
      "declare let assigned: SafeHtml;",
      "declare const holder: {html: SafeHtml};",
      "declare function consume(html: SafeHtml): void;",
      "const initialized: SafeHtml = value;",
      "assigned = value;",
      "holder.html = value;",
      "const objectLiteral: {html: SafeHtml} = {html: value};",
      "function produce(): SafeHtml { return value; }",
      "consume(value);",
      "void [initialized, objectLiteral, produce];",
    ].join("\n");
    const [result] = await eslint({"xss-sbyd/no-unsafe-cast-to-safe-type": "error"})
      .lintText(code, {filePath: "disable.ts"});
    assert.deepEqual(
      result.messages.map(({line, column, messageId}) => [line, column, messageId]),
      [
        [6, 31, "any"],
        [7, 12, "any"],
        [8, 15, "any"],
        [9, 48, "any"],
        [10, 39, "any"],
        [11, 9, "any"],
      ],
    );
  });

  test("reports every deliberately vulnerable sink family", async () => {
    const linter = eslint(plugin.configs.recommended[1].rules);
    const files = Object.keys(expectedVulnerableDiagnostics);
    const results = await linter.lintFiles(files);
    assert.deepEqual(diagnosticsByFile(results), expectedVulnerableDiagnostics);
  });

  test("accepts safe replacements and non-HTML responses", async () => {
    const results = await eslint(plugin.configs.recommended[1].rules).lintFiles(["app/valid.tsx", "app/sanitizer.tsx"]);
    for (const result of results) assert.deepEqual(result.messages, []);
  });

  test("recommended preset ignores generated and framework output", async () => {
    const linter = new ESLint({cwd: fixtures, overrideConfigFile: true, overrideConfig: plugin.configs.recommended});
    const results = await linter.lintFiles(["app/ignored.generated.tsx"]);
    assert.equal(results[0].warningCount, 1);
    assert.match(results[0].messages[0].message, /matching ignore pattern/);
  });

  test("offers no unsafe automatic fixes", async () => {
    const linter = new ESLint({
      cwd: fixtures,
      fix: true,
      overrideConfigFile: true,
      overrideConfig: plugin.configs.recommended,
    });
    const results = await linter.lintFiles(["app/vulnerable.tsx"]);
    assert.equal(results[0].output, undefined);
  });

  test("fails clearly when type-aware parser services are absent", async () => {
    const linter = new ESLint({
      cwd: fixtures,
      overrideConfigFile: true,
      overrideConfig: [{
        files: ["**/*.ts"],
        languageOptions: {parser: plugin.configs.recommended[1].languageOptions.parser},
        plugins: {"xss-sbyd": plugin},
        rules: {"xss-sbyd/no-unsafe-html-response": "error"},
      }],
    });
    await assert.rejects(() => linter.lintText("new Response('x')", {filePath: "missing-services.ts"}), /type information.*parserOptions/u);
  });

  test("passive URL sinks accept strings and spreads without rule options", async () => {
    const code = [
      'import Link from "next/link";',
      "declare const value: string;",
      "declare const props: Record<string, unknown>;",
      'const view = <><a href={value} {...props}>a</a><Link href={value}>b</Link><img src={value} srcSet={value} /></>;',
    ].join("\n");
    const [result] = await eslint({"xss-sbyd/safe-jsx-urls-navigation": "error"})
      .lintText(code, {filePath: "disable.tsx"});
    assert.deepEqual(result.messages, []);
  });

  test("rejects dangerous literals in both xlink href spellings", async () => {
    const code = [
      'const camel = <svg><use xlinkHref="javascript:alert(1)" /></svg>;',
      'const colon = <svg><use xlink:href="data:text/html,unsafe" /></svg>;',
      'const safe = <svg><use xlinkHref="/sprite.svg#icon" /></svg>;',
    ].join("\n");
    const [result] = await eslint({"xss-sbyd/safe-jsx-urls-active": "error"})
      .lintText(code, {filePath: "disable.tsx"});
    assert.deepEqual(result.messages.map(({messageId}) => messageId), ["dangerousLiteral", "dangerousLiteral", "active"]);
  });

  test("rejects indirect writeHead header objects", async () => {
    const code = [
      'import type {ServerResponse} from "node:http";',
      "declare const response: ServerResponse;",
      "declare const headers: Record<string, string>;",
      "response.writeHead(200, headers);",
      'response.writeHead(200, "OK", headers);',
      'response.writeHead(200, {"content-type": "application/json"});',
      'response.writeHead(200, "OK");',
      "response.writeHead(204);",
    ].join("\n");
    const [result] = await eslint({"xss-sbyd/no-html-content-type": "error"})
      .lintText(code, {filePath: "disable.ts"});
    assert.deepEqual(result.messages.map(({messageId}) => messageId), ["dynamic", "dynamic"]);
  });

  test("allows any and unknown spreads at runtime-validated passive URL sinks", async () => {
    const code = [
      'import Link from "next/link";',
      "declare const anyValue: any;",
      "declare const unknownValue: unknown;",
      "const view = <><a {...anyValue}>a</a><Link {...anyValue}>b</Link><img {...anyValue} /><a {...unknownValue}>c</a></>;",
    ].join("\n");
    const [result] = await eslint({"xss-sbyd/safe-jsx-urls-navigation": "error"})
      .lintText(code, {filePath: "disable.tsx"});
    assert.deepEqual(result.messages, []);
  });

  test("requires the validating JSX runtime and rejects direct bypasses", async () => {
    const code = [
      "/** @jsxImportSource react */",
      'import {jsx} from "react/jsx-runtime";',
      'import React, {cloneElement, createElement as h} from "react";',
      'h("a", {href: "/"});',
      'React.createElement("img", {src: "/x.png"});',
      'const existing = <script />;',
      'cloneElement(existing, {src: "/x.js"});',
      'React["cloneElement"](existing, {src: "/x.js"});',
      'h("div", null);',
      'const unrelated = {createElement() {}};',
      'unrelated.createElement("a");',
      "void jsx;",
    ].join("\n");
    const [result] = await eslint({"xss-sbyd/require-safe-jsx-runtime": "error"})
      .lintText(code, {filePath: "disable.tsx"});
    assert.deepEqual(result.messages.map(({messageId}) => messageId), ["pragma", "runtimeImport", "factoryBypass", "factoryBypass", "factoryBypass", "factoryBypass", "factoryBypass"]);
  });

  test("rejects classic JSX pragmas that disable the validating runtime", async () => {
    const code = [
      "/** @jsxRuntime classic */",
      "/** @jsx React.createElement */",
      'import React from "react";',
      "declare const anyProps: any;",
      "const view = <div {...anyProps} />;",
      "void view;",
    ].join("\n");
    const [result] = await eslint(plugin.configs.recommended[1].rules)
      .lintText(code, {filePath: "disable.tsx"});
    assert.deepEqual(
      result.messages.map(({ruleId, messageId}) => [ruleId, messageId]),
      [["xss-sbyd/require-safe-jsx-runtime", "pragma"]],
    );
  });

  test("rejects direct React factories when an intrinsic sink tag is dynamic", async () => {
    const code = [
      'import React, {createElement as h} from "react";',
      'declare const tag: "iframe" | "div";',
      "declare const attacker: string;",
      "React.createElement(tag, {srcDoc: attacker});",
      "h(tag, {srcDoc: attacker});",
    ].join("\n");
    const [result] = await eslint({"xss-sbyd/require-safe-jsx-runtime": "error"})
      .lintText(code, {filePath: "disable.tsx"});
    assert.deepEqual(
      result.messages.map(({messageId}) => messageId),
      ["factoryBypass", "factoryBypass"],
    );
  });

  test("rejects CommonJS bindings to raw React factories", async () => {
    const code = [
      "declare const attacker: string;",
      'const React = require("react");',
      'const {createElement: h} = require("react");',
      'import ReactTs = require("react");',
      'React.createElement("iframe", {srcDoc: attacker});',
      'h("iframe", {srcDoc: attacker});',
      'ReactTs.createElement("iframe", {srcDoc: attacker});',
    ].join("\n");
    const [result] = await eslint(plugin.configs.recommended[1].rules)
      .lintText(code, {filePath: "disable.tsx"});
    assert.deepEqual(
      result.messages.map(({ruleId, messageId}) => [ruleId, messageId]),
      Array(3).fill(["xss-sbyd/require-safe-jsx-runtime", "factoryBypass"]),
    );
  });

  test("rejects aliases of raw React factories", async () => {
    const code = [
      'import React from "react";',
      "declare const attacker: string;",
      "const h = React.createElement;",
      "const R = React;",
      "const {createElement: h2} = R;",
      'h("iframe", {srcDoc: attacker});',
      'R.createElement("iframe", {srcDoc: attacker});',
      'h2("iframe", {srcDoc: attacker});',
    ].join("\n");
    const [result] = await eslint(plugin.configs.recommended[1].rules)
      .lintText(code, {filePath: "disable.tsx"});
    assert.deepEqual(
      result.messages.map(({ruleId, messageId}) => [ruleId, messageId]),
      Array(3).fill(["xss-sbyd/require-safe-jsx-runtime", "factoryBypass"]),
    );
  });

  test("no-danger follows CommonJS and local aliases of raw React factories", async () => {
    const code = [
      'const React = require("react");',
      'const {createElement: h} = require("react");',
      'const R = React;',
      'const clone = R.cloneElement;',
      'declare const existing: React.ReactElement;',
      'declare const props: {dangerouslySetInnerHTML: {__html: string}};',
      'React.createElement("div", props);',
      'h("div", props);',
      'R.createElement("div", props);',
      'clone(existing, props);',
    ].join("\n");
    const [result] = await eslint({"xss-sbyd/no-danger": "error"})
      .lintText(code, {filePath: "disable.tsx"});
    assert.deepEqual(
      result.messages.map(({messageId}) => messageId),
      Array(4).fill("danger"),
    );
  });

  test("runtime-verified no-danger relaxes only JSX spreads", async () => {
    const code = [
      'import React, {cloneElement, createElement as h} from "react";',
      "declare const props: {dangerouslySetInnerHTML: {__html: string}};",
      "declare const anyProps: any;",
      "declare const existing: React.ReactElement;",
      "const spread = <div {...props} />;",
      "const unknownSpread = <div {...anyProps} />;",
      'const explicit = <div dangerouslySetInnerHTML={{__html: "unsafe"}} />;',
      'h("div", props);',
      "cloneElement(existing, anyProps);",
      "void [spread, unknownSpread, explicit];",
    ].join("\n");
    const [result] = await eslint({"xss-sbyd/no-danger": "error"})
      .lintText(code, {filePath: "disable.tsx"});
    assert.deepEqual(result.messages.map(({line, messageId}) => [line, messageId]), [
      [7, "danger"],
      [7, "danger"],
      [8, "danger"],
      [9, "danger"],
    ]);
  });

  test("checks the root App Router route handler", async () => {
    const linter = eslint({"xss-sbyd/no-unsafe-html-response": "error"});
    const [rootRoute] = await linter.lintFiles(["app/route.ts"]);
    const [ordinaryModule] = await linter.lintFiles(["app/helper.ts"]);
    assert.deepEqual(rootRoute.messages.map(({messageId}) => messageId), ["unsafe"]);
    assert.deepEqual(ordinaryModule.messages, []);
  });

  test("rejects byte-oriented API response bodies", async () => {
    const code = [
      'import type {NextApiResponse} from "next";',
      "declare const response: NextApiResponse;",
      'response.send(Buffer.from("<h1>unsafe</h1>"));',
      "response.end(new Uint8Array([60, 104, 49, 62]));",
      "response.json({safe: true});",
    ].join("\n");
    const [result] = await eslint({"xss-sbyd/no-unsafe-api-send": "error"})
      .lintText(code, {filePath: "disable.ts"});
    assert.deepEqual(result.messages.map(({messageId}) => messageId), ["unsafe", "unsafe"]);
  });

  test("rejects safe bodies at standard response constructors", async () => {
    const code = [
      'import type {SafeHtml as AuthenticatedHtml} from "next-xss-sbyd";',
      'import type {SafeStream as AuthenticatedStream} from "next-xss-sbyd/render";',
      "interface SafeHtml {value: string}",
      "declare const html: AuthenticatedHtml;",
      "declare const fake: SafeHtml;",
      "declare const stream: AuthenticatedStream;",
      "new Response(html);",
      "new Response(stream);",
      'new Response(html, {headers: {"content-type": "text/plain"}});',
      'new NextResponse(html, {headers: {"content-type": "application/json"}});',
      "new Response(fake);",
    ].join("\n");
    const [result] = await eslint({"xss-sbyd/no-unsafe-html-response": ["error", {customServerFiles: ["disable.ts"]}]})
      .lintText(code, {filePath: "disable.ts"});
    assert.deepEqual(
      result.messages.map(({messageId}) => messageId),
      ["safeBodyAtStandardConstructor", "safeBodyAtStandardConstructor", "safeBodyAtStandardConstructor", "safeBodyAtStandardConstructor", "unsafe"],
    );
  });

  test("accepts safe response constructors imported under standard constructor names", async () => {
    const code = [
      'import {SafeNextResponse as NextResponse, SafeResponse as Response, htmlEscape} from "next-xss-sbyd";',
      'new Response(htmlEscape("safe"));',
      'new NextResponse(htmlEscape("safe"));',
    ].join("\n");
    const [result] = await eslint({"xss-sbyd/no-unsafe-html-response": ["error", {customServerFiles: ["disable.ts"]}]})
      .lintText(code, {filePath: "disable.ts"});
    assert.deepEqual(result.messages, []);
  });

  test("resolves safe constructors through re-exports and respects shadowed imports", async () => {
    const code = [
      'import {SafeNextResponse as NextResponse, SafeResponse as Response} from "./responses.js";',
      'import * as xssSbyd from "next-xss-sbyd";',
      'import type {SafeHtml} from "next-xss-sbyd";',
      "declare const html: SafeHtml;",
      "new Response(html);",
      "new NextResponse(html);",
      "new xssSbyd.SafeResponse(html);",
      "function standard(Response: typeof globalThis.Response) {",
      "  new Response(html);",
      "}",
      "void standard;",
    ].join("\n");
    const [result] = await eslint({"xss-sbyd/no-unsafe-html-response": ["error", {customServerFiles: ["disable.ts"]}]})
      .lintText(code, {filePath: "disable.ts"});
    assert.deepEqual(
      result.messages.map(({line, messageId}) => [line, messageId]),
      [[9, "safeBodyAtStandardConstructor"]],
    );
  });

  test("gives distinct guidance for raw HTML and safe bodies at standard constructors", async () => {
    const code = [
      'import type {SafeHtml} from "next-xss-sbyd";',
      "declare const html: SafeHtml;",
      'new Response("<b>raw</b>", {headers: {"content-type": "text/html"}});',
      "new Response(html);",
    ].join("\n");
    const [result] = await eslint({"xss-sbyd/no-unsafe-html-response": ["error", {customServerFiles: ["disable.ts"]}]})
      .lintText(code, {filePath: "disable.ts"});
    assert.deepEqual(
      result.messages.map(({messageId, message}) => [messageId, message]),
      [
        ["rawHtml", "Raw HTML responses must be built with SafeResponse or SafeNextResponse from SafeHtml or SafeStream."],
        ["safeBodyAtStandardConstructor", "SafeHtml and SafeStream must be passed to SafeResponse or SafeNextResponse, not Response or NextResponse."],
      ],
    );
  });

  test("has no response-guard enablement option", async () => {
    const linter = eslint({"xss-sbyd/no-unsafe-html-response": ["error", {guardInstalled: false}]});
    await assert.rejects(
      () => linter.lintText("new Response('x')", {filePath: "disable.ts"}),
      /guardInstalled|configuration/u,
    );
  });

  test("rejects SafeHtml at ordinary API sinks even inside withSafeApiRoute", async () => {
    const code = [
      'import type {NextApiResponse} from "next";',
      'import type {SafeHtml} from "next-xss-sbyd";',
      'import {withSafeApiRoute} from "next-xss-sbyd/enforce";',
      "declare const html: SafeHtml;",
      "export default withSafeApiRoute(function handler(_req: unknown, res: NextApiResponse) {",
      "  res.send(html);",
      "  res.end(html);",
      "  res.write(html);",
      "});",
    ].join("\n");
    const [result] = await eslint({"xss-sbyd/no-unsafe-api-send": "error"})
      .lintText(code, {filePath: "disable.ts"});
    assert.deepEqual(result.messages.map(({line, messageId}) => [line, messageId]), [[6, "safeBody"], [7, "safeBody"], [8, "safeBody"]]);
  });

  test("rejects ordinary SafeHtml sinks in a named wrapped handler", async () => {
    const code = [
      'import type {NextApiResponse} from "next";',
      'import type {SafeHtml as AuthenticatedHtml} from "next-xss-sbyd";',
      'import {withSafeApiRoute} from "next-xss-sbyd/enforce";',
      "declare const html: AuthenticatedHtml;",
      "const handler = (_req: unknown, res: NextApiResponse) => {",
      "  res.send(html);",
      "  res.write(html);",
      "};",
      "export default withSafeApiRoute(handler);",
    ].join("\n");
    const [result] = await eslint({"xss-sbyd/no-unsafe-api-send": "error"})
      .lintText(code, {filePath: "disable.ts"});
    assert.deepEqual(result.messages.map(({line, messageId}) => [line, messageId]), [[6, "safeBody"], [7, "safeBody"]]);
  });


  test("rejects every safe body at ordinary Node and HTTP2 sinks", async () => {
    const code = [
      'import type {ServerResponse} from "node:http";',
      'import type {Http2ServerResponse} from "node:http2";',
      'import type {SafeHtml} from "next-xss-sbyd";',
      'import type {SafeStream, SafeNodeStream} from "next-xss-sbyd/render";',
      'interface CustomResponse extends ServerResponse {}',
      'declare const res: CustomResponse;',
      'declare const h2: Http2ServerResponse;',
      'declare const html: SafeHtml;',
      'declare const web: SafeStream;',
      'declare const node: SafeNodeStream;',
      'res.end(html); res.write(web); res.end(node); h2.end(html); h2.write(node);',
      'const queue = {send(value: SafeHtml) {}}; queue.send(html);',
    ].join("\n");
    const [result] = await eslint({"xss-sbyd/no-unsafe-api-send": "error"})
      .lintText(code, {filePath: "disable.ts"});
    assert.deepEqual(result.messages.map(({messageId}) => messageId), Array(5).fill("safeBody"));
    assert.ok(result.messages.every((message) => message.fix === undefined));
  });

  test("autofixes proven SafeHtml member calls only on augmented responses", async () => {
    const code = [
      'import type {NextApiResponse} from "next";',
      'import type {SafeHtml} from "next-xss-sbyd";',
      'import type {SafeApiResponse} from "next-xss-sbyd/enforce";',
      'declare const res: SafeApiResponse;',
      'declare const ordinary: NextApiResponse;',
      'declare const html: SafeHtml;',
      'declare const mixed: SafeHtml | string;',
      'res.status(201).send(html);',
      'res["end"](html, () => {});',
      'ordinary.send(html); res.write(html); res.send(mixed);',
      'res.send?.(html); res.end(html, "utf8", () => {}); res.end(html, "utf8");',
      'res.send("raw"); res.json({ok: true});',
    ].join("\n");
    const linter = eslint({"xss-sbyd/no-unsafe-api-send": "error"});
    const [result] = await linter.lintText(code, {filePath: "disable.ts"});
    assert.equal(result.messages.length, 9);
    const fixes = result.messages.filter((message) => message.fix).map((message) => message.fix);
    assert.equal(fixes.length, 2);
    let fixed = code;
    for (const fix of fixes.reverse()) fixed = fixed.slice(0, fix.range[0]) + fix.text + fixed.slice(fix.range[1]);
    assert.match(fixed, /res.status\(201\).safeSend\(html\)/u);
    assert.match(fixed, /res\["safeEnd"\]\(html, \(\) => \{\}\)/u);
    const [checked] = await linter.lintText(fixed, {filePath: "disable.ts"});
    assert.equal(checked.messages.length, 7);
  });


  test("keeps ambiguous API calls for review without unsafe method rewrites", async () => {
    const code = [
      'import type {NextApiResponse} from "next";',
      'import type {SafeApiResponse} from "next-xss-sbyd/enforce";',
      'import type {SafeHtml} from "next-xss-sbyd";',
      'declare const response: SafeApiResponse;',
      'declare const plain: NextApiResponse;',
      'declare const html: SafeHtml;',
      'declare const unknownBody: unknown;',
      'declare const anyBody: any;',
      'declare const args: [SafeHtml];',
      'declare const callbacks: [() => void];',
      'const send = "send";',
      'response[send](html); response.send(...args); response.end();',
      'response.send({ok: true}); response.send(unknownBody); response.send(anyBody);',
      'response.end(html, ...callbacks);',
      'response.end(html, () => {}, "extra");',
      'response?.send(html);',
      'const {send: detached} = plain; detached(html);',
      'function legacy(plain: NextApiResponse) { const {send} = plain; send(html); }',
      'declare const nullable: SafeHtml | undefined; response.send(nullable);',
    ].join("\n");
    const [result] = await eslint({"xss-sbyd/no-unsafe-api-send": "error"})
      .lintText(code, {filePath: "disable.ts"});
    assert.deepEqual(result.messages.map(({line, messageId}) => [line, messageId]), [
      [14, "safeBody"], [15, "safeBody"], [16, "safeBody"], [18, "safeBody"], [19, "safeBody"],
    ]);
    assert.ok(result.messages.every((message) => message.fix === undefined));
  });

  test("requires an authenticated wrapper in Pages API export chains", async () => {
    const imports = [
      'import {withSafeApiRoute as protect} from "next-xss-sbyd/enforce";',
      'import * as security from "next-xss-sbyd/enforce";',
      'const handler = (_req: unknown, res: unknown) => {};',
      'const withAuth = <T,>(handler: T): T => handler;',
      'function withOptions<T>(options: object, handler: T): T { return handler; }',
      'function compose<T>(logging: unknown, handler: T): T { return handler; }',
    ].join("\n");
    const accepted = [
      'export default protect(handler);',
      'export default withAuth(protect(handler));',
      'export default protect(withAuth(handler));',
      'export default withOptions({roles: ["admin"]}, protect(handler));',
      'export default compose(withAuth, protect(handler));',
      'const secured = protect(handler); export default withOptions({}, withAuth(secured));',
      'const cycle = cycle; export default compose(cycle, protect(handler));',
      'declare const args: unknown[]; export default compose(...args, protect(handler));',
      'export default security.withSafeApiRoute(handler);',
      'export default security["withSafeApiRoute"](handler);',
      'export default protect(handler)!;',
      'export default (protect(handler) as unknown);',
      'const secured = protect(handler); export {secured as "default"};',
      'const secured = protect(handler); const composed = withAuth(secured); export default composed;',
      'const secured = protect(handler); export {secured as default};',
      'export default (protect(handler) satisfies unknown);',
    ];
    const rejected = [
      'export default handler;',
      'export default withAuth(handler);',
      'export default withOptions({roles: ["admin"]}, handler);',
      'export default compose(withAuth, () => protect(handler));',
      'export default compose(withAuth, {handler: protect(handler)});',
      'const cycle = cycle; export default compose(cycle, cycle);',
      'function withSafeApiRoute<T>(h: T) { return h; } export default withSafeApiRoute(handler);',
      'const protectedElsewhere = protect(handler); export default handler;',
      'let secured = protect(handler); secured = handler; export default secured;',
      'export default withAuth(() => protect(handler));',
      'export {handler as default};',
      'export {default} from "./other.js";',
      'const a = b; const b = a; export default a;',
      'export default missingHandler;',
      'export default protect();',
      'export default withAuth();',
      'declare const args: unknown[]; export default withAuth(...args);',
      'export default missingNamespace.withSafeApiRoute(handler);',
      'declare const method: string; export default security[method](handler);',
      'export const helper = protect(handler); export {handler as named}; export default handler;',
      'export * from "./other.js"; export default handler;',
    ];
    const linter = eslint({"xss-sbyd/require-safe-api-route": "error"});
    for (const suffix of accepted) {
      const [result] = await linter.lintText(imports + "\n" + suffix, {filePath: "pages/api/vulnerable.ts"});
      assert.deepEqual(result.messages, [], suffix);
    }
    for (const suffix of rejected) {
      const [result] = await linter.lintText(imports + "\n" + suffix, {filePath: "pages/api/vulnerable.ts"});
      assert.deepEqual(result.messages.map(({messageId}) => messageId), ["wrapper"], suffix);
    }
    const [outside] = await linter.lintText('export default () => {};', {filePath: "disable.ts"});
    assert.deepEqual(outside.messages, []);
  });

  test("requires SafeHtml for iframe srcdoc documents", async () => {
    const code = [
      'import type {SafeHtml} from "next-xss-sbyd";',
      "declare const raw: string;",
      "declare const safe: SafeHtml;",
      "declare const props: {srcDoc: string};",
      "const view = <><iframe srcDoc={raw} /><iframe srcdoc={raw} /><iframe {...props} /><iframe srcDoc={safe} /></>;",
    ].join("\n");
    const [result] = await eslint({"xss-sbyd/safe-jsx-urls-active": "error"})
      .lintText(code, {filePath: "disable.tsx"});
    assert.deepEqual(result.messages.map(({messageId}) => messageId), ["srcdoc", "srcdoc", "srcdoc"]);
  });

  test("rejects both literal and dynamic strings at active-content URL sinks", async () => {
    const code = [
      'import Script from "next/script";',
      'declare const value: string;',
      'const view = <><script src="/app.js" /><iframe src={value} /><Script src="/next.js" /></>;',
    ].join("\n");
    const [result] = await eslint({"xss-sbyd/safe-jsx-urls-active": "error"})
      .lintText(code, {filePath: "disable.tsx"});
    assert.deepEqual(result.messages.map(({messageId}) => messageId), ["active", "active", "active"]);
  });

  test("rejects renderers from every supported react-dom server entrypoint", async () => {
    const code = [
      'import {renderToString} from "react-dom/server";',
      'import {renderToStaticMarkup as render} from "react-dom/server.browser";',
      'import {renderToPipeableStream} from "react-dom/server.node";',
      'import {renderToReadableStream} from "react-dom/server.edge";',
      'import * as BunServer from "react-dom/server.bun";',
      'import {renderToString as clientRender} from "react-dom/client";',
      'void [renderToString, render, renderToPipeableStream, renderToReadableStream, BunServer, clientRender];',
    ].join("\n");
    const [result] = await eslint({"xss-sbyd/no-raw-render-to-string": "error"}).lintText(code, {filePath: "disable.tsx"});
    assert.equal(result.messages.length, 5);
    assert.ok(result.messages.every((message) => message.ruleId === "xss-sbyd/no-raw-render-to-string"));
  });

  test("rejects dynamic imports and re-exports of raw renderers", async () => {
    const code = [
      'async function render() { return import("react-dom/server"); }',
      'export {renderToStaticMarkup} from "react-dom/server";',
      'export * from "react-dom/server.edge";',
      'export {version} from "react-dom/server";',
    ].join("\n");
    const [result] = await eslint({"xss-sbyd/no-raw-render-to-string": "error"})
      .lintText(code, {filePath: "disable.tsx"});
    assert.deepEqual(result.messages.map(({messageId}) => messageId), ["rawRenderer", "rawRenderer", "rawRenderer"]);
  });
});

describe("lint migration preset", () => {
  test("passes clean files and warns on security findings", async () => {
    const linter = new ESLint({
      cwd: fixtures,
      overrideConfigFile: true,
      overrideConfig: plugin.configs.lintMigration,
    });
    const [safe] = await linter.lintFiles(["app/helper.ts"]);
    const [vulnerable] = await linter.lintFiles(["pages/api/vulnerable.ts"]);
    assert.deepEqual(safe.messages, []);
    assert.deepEqual(
      vulnerable.messages.map(({ruleId, severity, messageId}) => [ruleId, severity, messageId]),
      [
        ...expectedVulnerableDiagnostics["pages/api/vulnerable.ts"].map(([, , ruleId, messageId]) => [
          `xss-sbyd/${ruleId}`,
          1,
          messageId,
        ]),
      ],
    );
  });

  test("keeps lint migration configuration identifiable and enforcement rules enabled", () => {
    assert.equal(plugin.configs.lintMigration.length, plugin.configs.recommended.length);
    assert.equal(plugin.configs.lintMigration.find((config) => config.rules)?.name, "xss-sbyd/lint-migration");
    assert.equal(
      plugin.configs.lintMigration.find((config) => config.rules)?.rules["xss-sbyd/require-disable-justification"],
      "error",
    );
  });
});

describe("disable justifications", () => {
  test("requires a rule name and reason only for xss-sbyd disables", async () => {
    const linter = eslint({"xss-sbyd/require-disable-justification": "error"});
    const cases = [
      ["/* eslint-disable */\nconst value = 1;", "unlimited"],
      ["/* eslint-disable xss-sbyd/no-danger */\nconst value = 1;", "description"],
      ["/* eslint-disable xss-sbyd/no-danger -- reviewed CMS output */\nconst value = 1;", null],
      ["/* eslint-disable eqeqeq */\nconst value = 1;", null],
    ];
    for (const [code, messageId] of cases) {
      const [result] = await linter.lintText(code, {filePath: "disable.ts"});
      assert.equal(result.messages[0]?.messageId ?? null, messageId);
    }
  });
});
