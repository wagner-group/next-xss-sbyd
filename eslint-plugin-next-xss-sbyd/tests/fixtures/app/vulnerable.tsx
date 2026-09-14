import LinkAlias from "next/link";
import ImageAlias from "next/image";
import FormAlias from "next/form";
import ScriptAlias from "next/script";
import {renderToString as render, renderToPipeableStream} from "react-dom/server";
import * as RawServerRenderers from "react-dom/server";
import type {SafeHtml, SafeHtml as RenamedSafeHtml} from "next-xss-sbyd";
import type * as XssSbydTypes from "next-xss-sbyd";
import {SafeBlock} from "next-xss-sbyd";

declare const input: string;
declare const arbitrary: any;
declare const rawHtmlProps: {dangerouslySetInnerHTML: {__html: string}};
declare const navigationProps: {href: string};
declare const resourceProps: {src: string};
declare const activeProps: {src: string};
declare const formProps: {action: string};
declare const scriptContentProps: {children: string};
type SafeNavigationUrl = string & {readonly fakeBrand: true};
declare const spoofedNavigation: SafeNavigationUrl;
type NestedSafeHtml = RenamedSafeHtml;
declare const holder: {html: SafeHtml};

const laundered: SafeHtml = arbitrary;
let assigned: SafeHtml;
assigned = arbitrary;
holder.html = arbitrary;
function returnLaundered(): SafeHtml { return arbitrary; }

export function sinks() {
  const html = `<main>${input}</main>`;
  const cast = input as unknown as SafeHtml;
  const anyCast = arbitrary as SafeHtml;
  const aliasCast = input as NestedSafeHtml;
  const qualifiedCast = input as XssSbydTypes.SafeHtml;
  render(<div>{input}</div>);
  renderToPipeableStream(<div>{input}</div>);
  RawServerRenderers.renderToStaticMarkup(<div>{input}</div>);
  return <>
    <div dangerouslySetInnerHTML={{__html: input}} />
    <div {...rawHtmlProps} />
    <SafeBlock html={arbitrary} />
    <script>{input}</script>
    <style>{input}</style>
    <ScriptAlias>{input}</ScriptAlias>
    <script src={input} />
    <script {...activeProps} />
    <script {...scriptContentProps} />
    <iframe src={input} />
    <object data={input} />
    <link rel="stylesheet" href={input} />
    <link rel={input} href={input} />
    <svg><use xlinkHref={input} /></svg>
    <base href="/rewritten" />
    <meta httpEquiv={"refresh"} content="0; url=/" />
    <form action={input} />
    <form {...formProps} />
    <button formAction={input}>submit</button>
    <FormAlias action={input}>submit</FormAlias>
    <a href={input}>link</a>
    <a {...navigationProps}>spread link</a>
    <LinkAlias {...navigationProps}>spread Next link</LinkAlias>
    <a href={spoofedNavigation}>spoofed link</a>
    <area href={input} />
    <LinkAlias href={input}>link</LinkAlias>
    <img src={input} srcSet={input} />
    <img {...resourceProps} />
    <ImageAlias {...resourceProps} alt="" />
    <video poster={input} />
    <ImageAlias src={input} alt="" />
    <a href="JaVaScRiPt:alert(1)">bad</a>
    <a href={"java\nscript:alert(1)"}>bad expression</a>
  </>;
}

export function headers(headers: Headers, response: Response, media: string) {
  headers["set"]("CONTENT-TYPE", "text/html; charset=utf-8");
  headers.append("content-type", media);
  response.headers?.set("Content-Type", "application/xhtml+xml");
}

void [cast, anyCast, aliasCast, qualifiedCast, laundered, assigned, returnLaundered];
