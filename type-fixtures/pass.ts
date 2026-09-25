import type {
  SafeHtml,
  SafeScript,
  SafeStyleSheet,
  TrustedScriptUrl,
} from "next-xss-sbyd";
import {
  validateUrl,
  validateUrlOrNull,
  withQuery,
  queryValue,
  SafeResponse,
} from "next-xss-sbyd";
import {SafeBlock, SafeExternalIframe, SafeJsonScript, SafeScriptBlock, SafeStyleBlock} from "next-xss-sbyd";
import type {CspNonce} from "next-xss-sbyd/csp";
import {createContentSecurityPolicy} from "next-xss-sbyd/csp";
import {
  safeRenderToPipeableStream,
  safeRenderToReadableStream,
  safeRenderToString,
} from "next-xss-sbyd/render";

declare const html: SafeHtml;
declare const script: SafeScript;
declare const styleSheet: SafeStyleSheet;
declare const resourceUrl: TrustedScriptUrl;
declare const nonce: CspNonce;

new SafeResponse(html);
const validated: string = validateUrl("/account");
const optionalUrl: string | null = validateUrlOrNull("/avatar.png");
const queried: string = withQuery("/search", {q: queryValue("hello")});
// @ts-expect-error Nullable validation must be checked before assigning to string.
const requiredUrl: string = validateUrlOrNull("/account");
// @ts-expect-error The navigation URL brand has been removed.
import type {SafeNavigationUrl} from "next-xss-sbyd";
// @ts-expect-error The resource URL brand has been removed.
import type {SafeResourceUrl} from "next-xss-sbyd";
// @ts-expect-error The form action URL brand has been removed.
import type {SafeFormActionUrl} from "next-xss-sbyd";
// @ts-expect-error The old navigation builder has been removed.
import {navigationUrl} from "next-xss-sbyd";
// @ts-expect-error The old resource builder has been removed.
import {resourceUrl as removedResourceUrl} from "next-xss-sbyd";
// @ts-expect-error The old form action builder has been removed.
import {formActionUrl} from "next-xss-sbyd";
// @ts-expect-error The old nullable navigation builder has been removed.
import {navigationUrlOrNull} from "next-xss-sbyd";
// @ts-expect-error The old nullable resource builder has been removed.
import {resourceUrlOrNull} from "next-xss-sbyd";
SafeBlock({html});
SafeExternalIframe({src: resourceUrl, sandbox: "", title: "Static content"});
SafeExternalIframe({src: resourceUrl, sandbox: "allow-scripts", title: "Scripted embed"});
// @ts-expect-error SafeExternalIframe requires a sandbox policy.
SafeExternalIframe({src: resourceUrl});
// @ts-expect-error SafeExternalIframe accepts only its fixed sandbox profiles.
SafeExternalIframe({src: resourceUrl, sandbox: "allow-same-origin"});
// @ts-expect-error SafeExternalIframe rejects the sandbox-escape-prone scripts/same-origin pairing.
SafeExternalIframe({src: resourceUrl, sandbox: "allow-scripts allow-same-origin"});
// @ts-expect-error SafeExternalIframe does not accept srcDoc.
SafeExternalIframe({src: resourceUrl, sandbox: "", srcDoc: "<p>unsafe</p>"});
// @ts-expect-error SafeExternalIframe requires TrustedScriptUrl rather than a string.
SafeExternalIframe({src: "https://example.com/embed", sandbox: ""});
SafeJsonScript({id: "state", data: {safe: true}});
SafeScriptBlock({script, nonce});
SafeStyleBlock({css: styleSheet, nonce});
createContentSecurityPolicy(nonce);
safeRenderToString(null);
safeRenderToReadableStream(null, {bootstrapScripts: [resourceUrl], nonce});
safeRenderToPipeableStream(null, {bootstrapModules: [resourceUrl], nonce});
void script;
void styleSheet;
void resourceUrl;
void [validated, optionalUrl, queried];

// Pages handlers infer the safe response, including Next's fluent helpers.
import type {NextApiRequest, NextApiResponse} from "next";
import type {IncomingMessage, ServerResponse} from "node:http";
import type {Http2ServerRequest, Http2ServerResponse} from "node:http2";
import type {SafeApiResponse} from "next-xss-sbyd";
import type {SafeApiResponse as EnforceSafeApiResponse} from "next-xss-sbyd/enforce";
import {withSafeApiRoute} from "next-xss-sbyd/enforce";

withSafeApiRoute((req, res) => {
  const query = req.query;
  const sent: void = res.status(201).safeSend(html);
  const ended: SafeApiResponse = res.setHeader("x-test", "yes").safeEnd(html, () => {});
  const json: NextApiResponse = res.status(200);
  res.json({ok: true});
  res.redirect("/next");
  res.end();
  res.write(Buffer.from("bytes"));
  // @ts-expect-error Explicit sinks require SafeHtml.
  res.safeSend("raw");
  // @ts-expect-error safeEnd never accepts an encoding argument.
  res.safeEnd(html, "utf8");
  // @ts-expect-error Explicit sinks require SafeHtml.
  res.safeEnd("raw");
  void query; void sent; void ended; void json;
});
function namedHandler(_req: NextApiRequest, res: SafeApiResponse) {
  const exportedFromEnforce: EnforceSafeApiResponse = res;
  exportedFromEnforce.safeSend(html);
}
withSafeApiRoute(namedHandler);
withSafeApiRoute<IncomingMessage, ServerResponse>((req, res) => {
  const ended: SafeApiResponse<ServerResponse> = res.safeEnd(html);
  res.setHeader("x-test", req.method ?? "GET").safeSend(html);
  void ended;
});
withSafeApiRoute<Http2ServerRequest, Http2ServerResponse>((req, res) => {
  const ended: SafeApiResponse<Http2ServerResponse> = res.safeEnd(html, () => {});
  res.setHeader("x-test", req.method);
  res.safeSend(html);
  void ended;
});
// @ts-expect-error The old standalone safeSend export has been removed.
import {safeSend} from "next-xss-sbyd";
// @ts-expect-error The old HtmlApiResponse interface has been removed.
import type {HtmlApiResponse} from "next-xss-sbyd";
void safeSend;

withSafeApiRoute<NextApiRequest, NextApiResponse<{ok: boolean}>>((_req, res) => {
  res.json({ok: true});
  res.status(201).json({ok: false});
  // @ts-expect-error The wrapper preserves typed JSON bodies.
  res.json({ok: "wrong"});
  // @ts-expect-error Next's status chaining preserves typed JSON bodies.
  res.status(201).json({wrong: true});
  res.setDraftMode({enable: true}).safeSend(html);
  res.setPreviewData({preview: true}).safeEnd(html);
  res.clearPreviewData().safeSend(html);
});
function legacyHandler(_req: NextApiRequest, res: NextApiResponse<{ok: boolean}>) {
  res.json({ok: true});
  // @ts-expect-error Legacy typed Next handlers retain their JSON contract.
  res.json({ok: "wrong"});
  // @ts-expect-error A plain Next response does not install safe methods.
  res.safeSend(html);
  // @ts-expect-error A plain Next response does not install safe methods.
  res.safeEnd(html);
}
withSafeApiRoute(legacyHandler);
interface CustomResponse extends ServerResponse {
  applicationId: string;
}
withSafeApiRoute<IncomingMessage, CustomResponse>((_req, res) => {
  const applicationId: string = res.applicationId;
  res.statusCode = 200;
  res.safeEnd(html);
  res.appendHeader("x-test", "yes").safeSend(html);
  res.setTimeout(1000).safeEnd(html);
  res.on("finish", () => {}).safeSend(html);
  // @ts-expect-error Custom Node responses do not acquire Next's status helper.
  res.status(200);
  void applicationId;
});

import type {NextApiHandler} from "next";
import {createServer} from "node:http";
const nextHandler: NextApiHandler = withSafeApiRoute(namedHandler);
const composedHandler: NextApiHandler = withSafeApiRoute(withSafeApiRoute(namedHandler));
createServer(withSafeApiRoute<IncomingMessage, ServerResponse>((_req, res) => {
  res.safeSend(html);
}));
void nextHandler;
void composedHandler;

import {sanitizeUserHtml} from "next-xss-sbyd/sanitize";
import {sanitizeUserHtml as sanitizeNode} from "next-xss-sbyd/sanitize-node";
const sanitized: SafeHtml = sanitizeUserHtml("<mark>safe</mark>");
SafeBlock({html: sanitized});
SafeBlock({html: sanitizeNode("<img src='/image.png'>")});
// @ts-expect-error The universal API accepts exactly one argument.
sanitizeUserHtml("html", {});
// @ts-expect-error The Node alias accepts exactly one argument.
sanitizeNode("html", undefined);
// @ts-expect-error Sanitizer inputs must be strings.
sanitizeUserHtml({html: "unsafe"});
// @ts-expect-error Policy selection has been removed.
import {inertRichTextPolicy} from "next-xss-sbyd/sanitize-node";
// @ts-expect-error Policy types have been removed.
import type {NamedHtmlPolicy} from "next-xss-sbyd/sanitize-node";
// @ts-expect-error No public policy family is exposed.
import {richTextPolicy, richTextWithImagesPolicy, richTextWithMediaPolicy} from "next-xss-sbyd/sanitize";
// @ts-expect-error The browser adapter is private.
import {sanitizeUserHtml as privateBrowser} from "next-xss-sbyd/sanitize-browser";

import {withSafeRouteHandler} from "next-xss-sbyd/enforce";
import type {NextRequest} from "next/server.js";
const appRoute = withSafeRouteHandler(async (request: NextRequest, context: {params: Promise<{id: string}>}) => {
  return Response.json({id: (await context.params).id, url: request.nextUrl.pathname});
});
const routeContract: (request: NextRequest, context: {params: Promise<{id: string}>}) => Promise<Response> = appRoute;
void routeContract;
// @ts-expect-error Handler results must be actual responses.
withSafeRouteHandler(() => ({body: "unsafe"}));
// @ts-expect-error Existing context types are preserved by the wrapper.
appRoute(new Request("https://example.test"), {params: {id: "wrong"}});

import {passiveResponse, type PassiveResponse} from "next-xss-sbyd/route-handler";
import type {PassiveResponse as EnforcedPassiveResponse} from "next-xss-sbyd/enforce";
const passive: PassiveResponse = passiveResponse(Response.json({ok: true}));
const enforcedPassive: EnforcedPassiveResponse = passive;
const nativePassive: Response = passive;
async function passiveHelper(): Promise<PassiveResponse> { return passive; }
void [enforcedPassive, nativePassive, passiveHelper];
// @ts-expect-error Native responses have not passed the passive response check.
const uncheckedPassive: PassiveResponse = Response.json({ok: true});
// @ts-expect-error Cloning returns a native response and does not retain the brand.
const clonedPassive: PassiveResponse = passive.clone();
// @ts-expect-error The brand symbol is private to the package.
import {passiveResponseBrand} from "next-xss-sbyd/route-handler";

// Deprecated iframe aliases remain compatible with the renamed public types.
import {SafeIframe} from "next-xss-sbyd";
import type {
  SafeExternalIframeProps,
  SafeExternalIframeSandbox,
  SafeIframeProps,
  SafeIframeSandbox,
} from "next-xss-sbyd";
const externalSandbox: SafeExternalIframeSandbox = "allow-scripts";
const legacySandbox: SafeIframeSandbox = externalSandbox;
const externalProps: SafeExternalIframeProps = {src: resourceUrl, sandbox: legacySandbox};
const legacyProps: SafeIframeProps = externalProps;
SafeIframe(legacyProps);
SafeExternalIframe(legacyProps);
// @ts-expect-error The deprecated sandbox type retains the fixed policy.
const invalidLegacySandbox: SafeIframeSandbox = "allow-same-origin";

// Trusted script URLs retain the unforgeable SafeValues type.
import {trustedScriptUrl} from "next-xss-sbyd";
// @ts-expect-error The former builder name has been removed.
import {trustedResourceUrl} from "next-xss-sbyd";
// @ts-expect-error The former type name has been removed.
import type {TrustedResourceUrl} from "next-xss-sbyd";
const scriptUrl: TrustedScriptUrl = trustedScriptUrl`/app.js`;
safeRenderToReadableStream(null, {bootstrapScripts: [scriptUrl, {src: scriptUrl}]});
// @ts-expect-error Raw strings are not trusted script URLs.
const rawScriptUrl: TrustedScriptUrl = "/raw.js";
// @ts-expect-error Lookalike objects cannot forge SafeValues' private brand.
const forgedScriptUrl: TrustedScriptUrl = {privateDoNotAccessOrElseWrappedResourceUrl: "/forged.js"};
// @ts-expect-error The builder requires a tagged template, not a string.
trustedScriptUrl("/app.js");
