// Installed verbatim as an ESM dependency and adapted to CommonJS by the runner.
import {jsx, jsxs, Fragment} from "react/jsx-runtime";
import {jsxDEV} from "react/jsx-dev-runtime";
import {createElement, cloneElement} from "react";

/** Return observations without ever mounting the unsafe elements. */
export function probes() {
  const result = {};
  const factories = {jsx, jsxs};
  if (process.env.NODE_ENV !== "production") factories.jsxDEV = jsxDEV;
  for (const [name, factory] of Object.entries(factories)) {
    const cases = {
      html: ["div", {dangerouslySetInnerHTML: {__html: "raw"}}],
      srcDoc: ["iframe", {srcDoc: "raw"}],
      url: ["a", {href: "javascript:alert(1)"}],
    };
    for (const [sink, [tag, props]] of Object.entries(cases)) {
      try {
        factory(tag, props, undefined, false, undefined, undefined);
        result[`${name}:${sink}`] = "accepted";
      } catch (error) {
        result[`${name}:${sink}`] = `${error.name}: ${error.message}`;
      }
    }
    result[`${name}:fragment`] = factory(Fragment, {children: "fragment"}, "key", false).key;
  }
  // These remain outside JSX-import redirection; detect accidental scope expansion.
  result.classic = createElement("div", {dangerouslySetInnerHTML: {__html: "raw"}}).props.dangerouslySetInnerHTML.__html;
  result.clone = cloneElement(jsx("div", {}), {dangerouslySetInnerHTML: {__html: "raw"}}).props.dangerouslySetInnerHTML.__html;
  return result;
}

/** Exercise SafeHtml provenance across the consumer and redirected dependency. */
export function safeElement(html, id) {
  return jsx("div", {id, dangerouslySetInnerHTML: {__html: html}});
}
