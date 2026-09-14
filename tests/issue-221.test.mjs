import assert from "node:assert/strict";
import test from "node:test";
import {createRequire} from "node:module";
import {parse} from "parse5";
import {JSDOM} from "jsdom";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {SafeBlock, SafeResponse} from "next-xss-sbyd";
import {sanitizeUserHtml} from "next-xss-sbyd/sanitize-node";
import {sanitizeUserHtml as universalSanitize} from "next-xss-sbyd/sanitize";

const depthError = {name: "TypeError", message: "sanitizeUserHtml input exceeds the maximum HTML element depth of 512"};

function nested(tag, depth) {
  return `<${tag}>`.repeat(depth) + "x" + `</${tag}>`.repeat(depth);
}

async function sanitize(dirty) {
  return new SafeResponse(sanitizeUserHtml(dirty)).text();
}

function Article({html}) {
  try {
    return createElement(SafeBlock, {as: "article", html: universalSanitize(html)});
  } catch (error) {
    assert.equal(error.constructor, TypeError);
    assert.equal(error.message, depthError.message);
    return createElement("p", null, "Article could not be displayed.");
  }
}

test("Node rejects excessive parsed depth through both public entry points", () => {
  for (const tag of ["b", "div"]) {
    for (const depth of [511, 3000, 5000, 100000]) {
      const dirty = nested(tag, depth);
      assert.throws(() => sanitizeUserHtml(dirty), depthError);
      assert.throws(() => universalSanitize(dirty), depthError);
    }
  }
});

test("the maximum element depth of 512 includes document wrappers but excludes text and comments", async () => {
  const dirty = nested("div", 510);
  assert.equal(await sanitize(dirty), dirty);
  assert.equal(await sanitize(nested("b", 510)), nested("b", 510));
  const comment = "<div>".repeat(510) + "<!--leaf-->x" + "</div>".repeat(510);
  assert.equal(await sanitize(comment), dirty);
  assert.equal(await sanitize(`<!doctype html><html><head></head><body>${dirty}</body></html>`), dirty);
  assert.equal(await sanitize(""), "");
  assert.equal(await sanitize("plain text"), "plain text");
});

test("depth validation follows HTML recovery, raw text, and template contents", async () => {
  assert.throws(() => sanitizeUserHtml("<div>".repeat(511)), depthError);
  assert.throws(() => sanitizeUserHtml(`<template>${nested("div", 510)}</template>`), depthError);
  assert.throws(() => sanitizeUserHtml(nested("template", 511)), depthError);
  assert.throws(() => sanitizeUserHtml(`<noscript>${nested("div", 511)}</noscript>`), depthError);
  assert.throws(() => sanitizeUserHtml(`<svg>${nested("g", 511)}</svg>`), depthError);
  assert.throws(() => sanitizeUserHtml(`<math>${nested("mrow", 511)}</math>`), depthError);
  assert.equal(await sanitize(`<template>${nested("div", 509)}</template><p>safe</p>`), "<p>safe</p>");
  assert.equal(await sanitize(`<script>${nested("div", 5000)}</script><p>safe</p>`), "<p>safe</p>");
  assert.equal(await sanitize(`<style>${nested("div", 5000)}</style><p>safe</p>`), "<p>safe</p>");
  assert.equal(await sanitize(`<p title="${"<div>".repeat(1000)}">safe</p>`), `<p title="${"<div>".repeat(1000)}">safe</p>`);
  // Repeated unclosed paragraphs and void tags are siblings after HTML parsing.
  assert.equal(await sanitize("<p>x".repeat(1000)), "<p>x</p>".repeat(1000));
  assert.equal(await sanitize("<br>".repeat(1000)), "<br>".repeat(1000));
  // The parser inserts tbody, which also contributes to the depth.
  assert.throws(() => sanitizeUserHtml("<div>".repeat(507) + "<table><tr><td>x"), depthError);
  assert.equal(await sanitize("<div>".repeat(509) + "<br>"),
    "<div>".repeat(509) + "<br>" + "</div>".repeat(509));
  // Void elements are in the tree but never pushed onto the parser's open stack.
  assert.throws(() => sanitizeUserHtml("<div>".repeat(510) + "<br>"), depthError);
});

test("temporary nesting is rejected even when a frameset discards the deep body", () => {
  assert.throws(() => sanitizeUserHtml("<b>".repeat(5000) + "<frameset>"), depthError);
});

test("large flat articles remain supported", async () => {
  const dirty = "<p><b>ordinary article text</b></p>".repeat(10000);
  assert.equal(await sanitize(dirty), dirty);
});

test("real server rendering recovers from excessive depth and still sanitizes later articles", () => {
  assert.equal(renderToStaticMarkup(createElement(Article, {html: nested("b", 5000)})),
    "<p>Article could not be displayed.</p>");
  assert.equal(renderToStaticMarkup(createElement(Article, {html: '<p onclick="alert(1)">safe<script>alert(1)</script></p>'})),
    "<article><p>safe</p></article>");
});

test("the pre-pass and JSDOM resolve the same HTML parser", () => {
  const packageRequire = createRequire(import.meta.resolve("next-xss-sbyd/sanitize-node"));
  const jsdomRequire = createRequire(packageRequire.resolve("jsdom"));
  assert.equal(packageRequire.resolve("parse5"), jsdomRequire.resolve("parse5"));
});

test("temporary table nesting can exceed the final tree depth", () => {
  assert.throws(() => sanitizeUserHtml("<table>" + "<div>".repeat(510) + "x"), depthError);
  assert.throws(() => sanitizeUserHtml("<div>".repeat(508) + "<table><select><option>x"), depthError);
});

function maximumElementDepth(document) {
  let maximum = 0;
  const stack = [{node: document, depth: 0}];
  while (stack.length) {
    const {node, depth} = stack.pop();
    const elementDepth = depth + (node.tagName ? 1 : 0);
    maximum = Math.max(maximum, elementDepth);
    for (const child of node.childNodes ?? []) stack.push({node: child, depth: elementDepth});
    if (node.content) stack.push({node: node.content, depth: elementDepth});
  }
  return maximum;
}

test("pre-pass parsing agrees with JSDOM DOMParser on malformed tree construction", () => {
  const window = new JSDOM("").window;
  try {
    const parser = new window.DOMParser();
    for (const dirty of [
      "<b><i><p>x</b>y</i>",
      "<table><div><b>x<tr><td>y",
      "<div><table><select><option>x",
      "<template><template><div><br></template></template>",
      "<select><optgroup><option>x<optgroup><option>y",
      "<b>".repeat(100) + "<frameset>",
      "<svg><foreignObject><div><br></foreignObject></svg>",
      '<math><annotation-xml encoding="text/html"><div><br></annotation-xml></math>',
      "<noscript><div><br></noscript>",
      "<div>".repeat(509) + "<br>",
      '<p title="<div>"><script><div></script><br>',
    ]) {
      assert.equal(maximumElementDepth(parse(dirty, {scriptingEnabled: false})),
        maximumElementDepth(parser.parseFromString(dirty, "text/html")), dirty);
    }
  } finally {
    window.close();
  }
});
