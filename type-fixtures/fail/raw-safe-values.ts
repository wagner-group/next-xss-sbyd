import type {
  SafeHtml,
  SafeNavigationUrl,
  SafeResourceUrl,
  SafeScript,
  SafeStyleSheet,
  TrustedScriptUrl,
} from "next-xss-sbyd";
import {
  navigationUrlOrNull,
  resourceUrlOrNull,
  SafeJsonScript,
  SafeResponse,
  SafeScriptBlock,
} from "next-xss-sbyd";
import {safeRenderToReadableStream} from "next-xss-sbyd/render";
import {configureJsxGuard} from "next-xss-sbyd";

new SafeResponse("<img src=x onerror=alert(1)>");
const html: SafeHtml = "<b>raw</b>";
const script: SafeScript = "alert(1)";
const styleSheet: SafeStyleSheet = "body{}";
const resourceUrl: TrustedScriptUrl = "javascript:alert(1)";
SafeScriptBlock({script: "alert(1)"});
SafeJsonScript({id: "state", data: {bad: undefined}});
safeRenderToReadableStream(null, {bootstrapScripts: ["/raw.js"]});
const requiredNavigation: SafeNavigationUrl = navigationUrlOrNull("/account");
const requiredResource: SafeResourceUrl = resourceUrlOrNull("/avatar.png");
void [
  html,
  script,
  styleSheet,
  resourceUrl,
  requiredNavigation,
  requiredResource,
];
void configureJsxGuard;
