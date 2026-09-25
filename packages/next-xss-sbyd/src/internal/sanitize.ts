import createDOMPurify from "dompurify";
import type {DOMPurify, WindowLike} from "dompurify";
import {htmlSafeByReview} from "safevalues/restricted/reviewed";
import type {SafeHtml} from "safevalues";
import {validateUrlOrNull} from "../url.js";

const ALLOWED_TAGS = [
  "a", "b", "blockquote", "br", "caption", "code", "del", "em", "h1", "h2", "h3",
  "h4", "h5", "h6", "hr", "i", "li", "ol", "p", "pre", "s", "strong", "table",
  "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul", "div", "span", "figure",
  "figcaption", "mark", "sub", "sup", "dl", "dt", "dd", "img", "audio", "video", "source",
];
const TEXT_ATTRIBUTES = ["title", "aria-label", "abbr", "scope", "alt"];
const ELEMENT_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  a: ["href"],
  td: ["abbr", "scope", "colspan", "rowspan"],
  th: ["abbr", "scope", "colspan", "rowspan"],
  img: ["src", "alt", "width", "height"],
  audio: ["src"],
  video: ["src", "poster", "width", "height"],
  source: ["src", "type"],
};
const SCOPES = new Set(["row", "col", "rowgroup", "colgroup"]);
const MEDIA_TYPES = new Set([
  "audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/webm",
  "video/mp4", "video/ogg", "video/webm",
]);

/** Creates a private engine without inheriting application configuration or hooks. */
export function createSanitizer(window: WindowLike): DOMPurify {
  const purifier = createDOMPurify(window);
  if (!purifier.isSupported) throw new Error("sanitizeUserHtml requires a supported DOM or Node adapter");
  purifier.addHook("uponSanitizeAttribute", function preserveParsedValue(node, event) {
    // DOMPurify trims by default. Our validators must see parsed, untrimmed
    // values, so whitespace cannot turn an invalid URL/integer/enum into a valid one.
    event.attrValue = node.getAttribute(event.attrName)!;
  });
  return purifier;
}

function cleanAttribute(tag: string, name: string, value: string): string | null {
  if (name === "title" || name === "aria-label") return value;
  if (!ELEMENT_ATTRIBUTES[tag]?.includes(name)) return null;
  if (name === "href" || name === "src" || name === "poster") return validateUrlOrNull(value);
  if (name === "scope") return SCOPES.has(value) ? value : null;
  if (name === "type") return MEDIA_TYPES.has(value) ? value : null;
  if (name === "width" || name === "height" || name === "colspan" || name === "rowspan") {
    const maximum = name === "width" || name === "height" ? 10000 : 1000;
    if (!/^[0-9]+$/.test(value)) return null;
    const number = Number(value);
    return number >= 1 && number <= maximum ? String(number) : null;
  }
  return value;
}

/** Applies the fixed policy completely before serializing and authenticating the result. */
export function sanitizeWith(purifier: DOMPurify, dirty: string): SafeHtml {
  const root = purifier.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["title", "aria-label", ...new Set(Object.values(ELEMENT_ATTRIBUTES).flat())],
    ADD_URI_SAFE_ATTR: TEXT_ATTRIBUTES,
    ALLOWED_NAMESPACES: ["http://www.w3.org/1999/xhtml"],
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    ADD_FORBID_CONTENTS: ["script", "style", "template", "svg", "math"],
    RETURN_DOM: true,
    RETURN_TRUSTED_TYPE: false,
  }) as HTMLElement;
  if (!root || root.nodeType !== 1) throw new Error("sanitizeUserHtml engine failed to return a sanitized DOM");
  for (const element of root.querySelectorAll("*")) {
    const tag = element.localName;
    for (const attribute of Array.from(element.attributes)) {
      const value = cleanAttribute(tag, attribute.name, attribute.value);
      if (value === null) element.removeAttribute(attribute.name);
      else element.setAttribute(attribute.name, value);
    }
    if (tag === "a" && element.hasAttribute("href")) {
      element.setAttribute("rel", "nofollow noopener noreferrer");
    }
    if (tag === "img") element.setAttribute("referrerpolicy", "no-referrer");
    if (tag === "audio" || tag === "video") {
      element.setAttribute("controls", "");
      element.setAttribute("preload", "none");
    }
    if (tag === "source" && (!element.hasAttribute("src") ||
      !["audio", "video"].includes(element.parentElement!.localName))) {
      element.remove();
    }
  }
  return htmlSafeByReview(root.innerHTML, {
    justification: "Produced by the private fixed next-xss-sbyd HTML sanitizer with per-element and URL validation",
  });
}
