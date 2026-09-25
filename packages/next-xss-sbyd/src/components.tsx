import {createElement} from "react";
import type {ComponentPropsWithoutRef, HTMLAttributes, ReactElement} from "react";
import type {SafeHtml, SafeScript, SafeStyleSheet, TrustedResourceUrl} from "safevalues";
import {unwrapHtml, unwrapResourceUrl, unwrapScript, unwrapStyleSheet} from "./internal/unwrap.js";
import type {CspNonce} from "./csp.js";

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | {readonly [key: string]: JsonValue};

type SafeBlockTag = "article" | "aside" | "div" | "footer" | "header" | "main" | "nav" | "section" | "span";
const SAFE_BLOCK_TAGS = new Set<SafeBlockTag>(["article", "aside", "div", "footer", "header", "main", "nav", "section", "span"]);

export interface SafeBlockProps extends Omit<HTMLAttributes<HTMLElement>, "children" | "dangerouslySetInnerHTML"> {
  readonly as?: SafeBlockTag;
  readonly html: SafeHtml;
}

/** Renders a validated SafeHtml fragment in a closed set of inert containers. */
export function SafeBlock({as = "div", html, ...props}: SafeBlockProps): ReactElement {
  if (!SAFE_BLOCK_TAGS.has(as)) throw new TypeError(`Unsafe SafeBlock container: ${JSON.stringify(as)}`);
  return createElement(as, {...props, dangerouslySetInnerHTML: {__html: unwrapHtml(html)}});
}

export type SafeExternalIframeSandbox = "" | "allow-scripts";

export interface SafeExternalIframeProps extends Omit<
  ComponentPropsWithoutRef<"iframe">,
  "dangerouslySetInnerHTML" | "sandbox" | "src" | "srcDoc"
> {
  readonly src: TrustedResourceUrl;
  readonly sandbox: SafeExternalIframeSandbox;
}

const SAFE_EXTERNAL_IFRAME_SANDBOXES: ReadonlySet<SafeExternalIframeSandbox> = new Set(["", "allow-scripts"]);

/** Renders a developer-controlled iframe URL under one of two fixed sandbox profiles. */
export function SafeExternalIframe({src, sandbox, ...props}: SafeExternalIframeProps): ReactElement {
  const unwrappedSrc = unwrapResourceUrl(src);
  if (!SAFE_EXTERNAL_IFRAME_SANDBOXES.has(sandbox)) {
    throw new TypeError(`Unsafe SafeExternalIframe sandbox: ${JSON.stringify(sandbox)}`);
  }
  for (const name of Object.keys(props)) {
    const normalizedName = name.toLowerCase();
    if (
      normalizedName === "sandbox" ||
      normalizedName === "src" ||
      normalizedName === "srcdoc" ||
      normalizedName.startsWith("dangerously")
    ) {
      throw new TypeError(`Unsafe SafeExternalIframe prop: ${JSON.stringify(name)}`);
    }
  }
  return createElement("iframe", {...props, sandbox, src: unwrappedSrc});
}

/** @deprecated Use SafeExternalIframe instead. */
export const SafeIframe = SafeExternalIframe;

/** @deprecated Use SafeExternalIframeProps instead. */
export type SafeIframeProps = SafeExternalIframeProps;

/** @deprecated Use SafeExternalIframeSandbox instead. */
export type SafeIframeSandbox = SafeExternalIframeSandbox;

function snapshotJson(value: unknown, ancestors: Set<object>, path: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`JSON data at ${path} contains a non-finite number`);
    return value;
  }
  if (typeof value !== "object") throw new TypeError(`JSON data at ${path} contains unsupported ${typeof value}`);
  if (ancestors.has(value)) throw new TypeError(`JSON data at ${path} contains a cycle`);

  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`JSON data at ${path} must contain only plain objects and arrays`);
  }
  if (Object.prototype.hasOwnProperty.call(value, "toJSON")) {
    throw new TypeError(`JSON data at ${path} must not define toJSON`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`JSON data at ${path} must not contain symbol keys`);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Array.from(value, (item, index) => snapshotJson(item, ancestors, `${path}[${index}]`));
    }
    const result = Object.create(null) as {[key: string]: JsonValue};
    for (const key of Object.keys(value)) {
      result[key] = snapshotJson((value as Record<string, unknown>)[key], ancestors, `${path}.${key}`);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

/** Serializes JSON for an HTML script data block without permitting an end-tag breakout. */
export function serializeJsonForHtml(value: JsonValue): string {
  const serialized = JSON.stringify(snapshotJson(value, new Set(), "$"));
  return serialized.replace(/[<>&\u2028\u2029]/g, (character) => {
    const hex = character.codePointAt(0)?.toString(16).padStart(4, "0") ?? "0000";
    return `\\u${hex}`;
  });
}

export interface SafeJsonScriptProps {
  readonly id: string;
  readonly data: JsonValue;
}

/** Emits inert application/json state with breakout-safe serialization. */
export function SafeJsonScript({id, data}: SafeJsonScriptProps): ReactElement {
  return <script id={id} type="application/json" dangerouslySetInnerHTML={{__html: serializeJsonForHtml(data)}} />;
}

export interface SafeJsonLdScriptProps {
  readonly data: JsonValue;
}

/** Emits inert JSON-LD data with breakout-safe serialization. */
export function SafeJsonLdScript({data}: SafeJsonLdScriptProps): ReactElement {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{__html: serializeJsonForHtml(data)}} />;
}

export interface SafeScriptBlockProps {
  readonly script: SafeScript;
  readonly nonce?: CspNonce;
}

/** Emits reviewed literal-only JavaScript, optionally authorized by a CSP nonce. */
export function SafeScriptBlock({script, nonce}: SafeScriptBlockProps): ReactElement {
  return <script nonce={nonce} dangerouslySetInnerHTML={{__html: unwrapScript(script)}} />;
}

export interface SafeStyleBlockProps {
  readonly css: SafeStyleSheet;
  readonly nonce?: CspNonce;
}

/** Emits a reviewed literal-only stylesheet, optionally authorized by a CSP nonce. */
export function SafeStyleBlock({css, nonce}: SafeStyleBlockProps): ReactElement {
  return <style nonce={nonce} dangerouslySetInnerHTML={{__html: unwrapStyleSheet(css)}} />;
}

/** Reads and parses a SafeJsonScript payload in a browser document. */
export function readJsonScript<T extends JsonValue = JsonValue>(id: string): T {
  const element = document.getElementById(id);
  if (element === null || element.tagName !== "SCRIPT" || element.getAttribute("type") !== "application/json") {
    throw new TypeError(`Safe JSON script ${JSON.stringify(id)} was not found`);
  }
  return JSON.parse(element.textContent ?? "") as T;
}
