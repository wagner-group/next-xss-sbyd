import type {NextApiResponse} from "next";
import {SafeBlock, SafeJsonScript, SafeResponse, formActionUrl, htmlEscape, navigationUrl, resourceUrl} from "next-xss-sbyd";
import {safeRenderToString} from "next-xss-sbyd/render";
import {trustedScriptUrl} from "next-xss-sbyd";
import type {SafeNavigationUrl as ImportedNavigationUrl} from "next-xss-sbyd";

type NavigationAlias = ImportedNavigationUrl;

const navigation = navigationUrl("/account");
const resource = resourceUrl("/avatar.png");
const form = formActionUrl("/submit");
const trusted = trustedScriptUrl`https://cdn.example.test/app.js`;
const aliasedNavigation: NavigationAlias = navigation;

export function Valid() {
  async function serverAction() { "use server"; }
  return <>
    <SafeBlock html={htmlEscape("<safe>")} />
    <SafeJsonScript id="state" data={{text: "</script>"}} />
    <a href={navigation}>account</a>
    <a {...{href: navigation}}>spread account</a>
    <div {...{className: "harmless"}}>content</div>
    <a href={aliasedNavigation}>aliased account</a>
    <img src={resource} />
    <form action={form} />
    <form action={serverAction} />
    <script src={trusted} />
    <script>{"literal script"}</script>
    <style>{"body { color: black; }"}</style>
  </>;
}

export function validResponses(response: NextApiResponse) {
  const tuples: [string, string][] = [["content-type", "text/plain"]];
  const textHeaders = new Headers(tuples);
  response.json({ok: true});
  const json = Response.json({ok: true});
  const binary = new Response(new Uint8Array([1, 2]), {headers: {"content-type": "image/png"}});
  const empty = new Response(null);
  const plain = new Response("plain", {headers: {"content-type": "text/plain; charset=utf-8"}});
  const indirectPlain = new Response("plain", {headers: textHeaders});
  const html = new SafeResponse(safeRenderToString(<Valid />));
  return [json, binary, empty, plain, indirectPlain, html];
}
