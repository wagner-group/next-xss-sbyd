import type {TrustedScriptUrl} from "./trusted-script-url.js";
import {unwrapResourceUrl} from "./internal/unwrap.js";
import {validateUrl} from "./url.js";

type Props = Record<string, unknown>;
type UrlValidator = (value: string) => string;

const PASSIVE_URL_PROPS: Readonly<Record<string, readonly string[]>> = {
  a: ["href"],
  area: ["href"],
  audio: ["src"],
  button: ["formAction"],
  form: ["action"],
  img: ["src"],
  input: ["src", "formAction"],
  source: ["src"],
  track: ["src"],
  video: ["src", "poster"],
};

const ACTIVE_SRC_TAGS = new Set(["embed", "frame", "iframe", "script"]);
const ACTIVE_SVG_TAGS = new Set(["feimage", "image", "use"]);
const ACTIVE_LINK_RELS = new Set(["stylesheet", "preload", "modulepreload", "import"]);
const UNSAFE_URL_OBJECT_FIELDS = ["auth", "host", "hostname", "href", "path", "port", "protocol", "search", "slashes"] as const;

function validateSrcSet(value: string): string {
  const candidates: string[] = [];
  let position = 0;
  while (position < value.length) {
    while (/[\s,]/u.test(value[position] ?? "")) position += 1;
    if (position >= value.length) break;
    const urlStart = position;
    while (position < value.length && !/\s/u.test(value[position])) position += 1;
    let rawUrl = value.slice(urlStart, position);
    let descriptor = "";
    if (rawUrl.endsWith(",")) {
      if (position === value.length) throw new TypeError(`Invalid srcSet: ${JSON.stringify(value)}`);
      rawUrl = rawUrl.replace(/,+$/u, "");
    } else {
      while (/\s/u.test(value[position] ?? "")) position += 1;
      const descriptorStart = position;
      let parentheses = 0;
      while (position < value.length) {
        const character = value[position];
        if (character === "(") parentheses += 1;
        else if (character === ")" && parentheses > 0) parentheses -= 1;
        else if (character === "," && parentheses === 0) break;
        position += 1;
      }
      descriptor = value.slice(descriptorStart, position).trim();
      if (value[position] === ",") position += 1;
    }
    if (rawUrl === "") throw new TypeError(`Invalid srcSet: ${JSON.stringify(value)}`);
    if (descriptor !== "" && !/^(?:[1-9][0-9]*w|(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)x)$/u.test(descriptor)) {
      throw new TypeError(`Invalid srcSet: ${JSON.stringify(value)}`);
    }
    candidates.push(`${validateUrl(rawUrl)}${descriptor === "" ? "" : ` ${descriptor}`}`);
  }
  if (candidates.length === 0) throw new TypeError(`Invalid srcSet: ${JSON.stringify(value)}`);
  return candidates.join(", ");
}

function withValue(props: Props, name: string, value: unknown): Props {
  if (Object.is(props[name], value)) return props;
  return {...props, [name]: value};
}

function matchingPropNames(props: Props, expectedName: string): string[] {
  const normalized = expectedName.toLowerCase();
  return Object.keys(props).filter((name) => name.toLowerCase() === normalized);
}

function validateStringProps(props: Props, name: string, validator: UrlValidator): Props {
  for (const actualName of matchingPropNames(props, name)) {
    const value = props[actualName];
    if (value === undefined || value === null) continue;
    if (typeof value === "function" && (name === "action" || name === "formAction")) continue;
    if (typeof value !== "string") throw new TypeError(`${name} requires a string value`);
    props = withValue(props, actualName, validator(value));
  }
  return props;
}

function unwrapTrustedProps(props: Props, name: string): Props {
  for (const actualName of matchingPropNames(props, name)) {
    const value = props[actualName];
    if (value !== undefined && value !== null) {
      props = withValue(props, actualName, unwrapResourceUrl(value as TrustedScriptUrl));
    }
  }
  return props;
}

function propValues(props: Props, name: string): unknown[] {
  return matchingPropNames(props, name).map((actualName) => props[actualName]);
}

function hasActiveLinkRel(value: unknown): boolean {
  if (typeof value !== "string") return true;
  return value.toLowerCase().split(/\s+/u).some((rel) => ACTIVE_LINK_RELS.has(rel));
}

/** Validates URL-bearing intrinsic-element props before React receives them. */
export function validateIntrinsicUrlProps(type: string, originalProps: Props): Props {
  const tag = type.toLowerCase();
  if (tag === "base" && propValues(originalProps, "href").some((value) => value !== undefined && value !== null)) {
    throw new TypeError("The forbidden base[href] sink can rewrite document URL resolution");
  }
  if (tag === "meta") {
    const httpEquivValues = [...propValues(originalProps, "httpEquiv"), ...propValues(originalProps, "http-equiv")];
    for (const httpEquiv of httpEquivValues) {
      if (httpEquiv === undefined || httpEquiv === null) continue;
      if (typeof httpEquiv !== "string") throw new TypeError("The forbidden meta refresh sink requires a string httpEquiv value");
      if (httpEquiv.toLowerCase() === "refresh") throw new TypeError("The forbidden meta refresh sink can trigger navigation");
    }
  }

  let props = originalProps;
  // Markdown renderers use an empty image src to remove a rejected URL.
  // Omit it rather than accepting empty resource URLs generally or asking older
  // React/browser versions to fetch the current document as an image.
  if (tag === "img") {
    for (const name of matchingPropNames(props, "src")) {
      if (props[name] === "") props = withValue(props, name, undefined);
    }
  }
  const passive = PASSIVE_URL_PROPS[tag];
  if (passive !== undefined) {
    for (const name of passive) props = validateStringProps(props, name, validateUrl);
  }
  if (tag === "img" || tag === "source") {
    props = validateStringProps(props, "srcSet", validateSrcSet);
  }

  if (ACTIVE_SRC_TAGS.has(tag)) props = unwrapTrustedProps(props, "src");
  if (tag === "object") props = unwrapTrustedProps(props, "data");
  if (tag === "link" && propValues(props, "rel").some(hasActiveLinkRel)) props = unwrapTrustedProps(props, "href");
  if (ACTIVE_SVG_TAGS.has(tag)) {
    props = unwrapTrustedProps(props, "href");
    props = unwrapTrustedProps(props, "xlinkHref");
    props = unwrapTrustedProps(props, "xlink:href");
  }
  return props;
}

/** Validates a Next Link URL string or its pathname-bearing UrlObject form. */
export function validateNavigationTarget<T>(target: T): T {
  if (typeof target === "string") return validateUrl(target) as T;
  if (target !== null && typeof target === "object") {
    for (const field of UNSAFE_URL_OBJECT_FIELDS) {
      if ((target as Record<string, unknown>)[field] !== undefined && (target as Record<string, unknown>)[field] !== null) {
        throw new TypeError(`Invalid navigation URL object: ${field} is not allowed`);
      }
    }
    const pathname = (target as {pathname?: unknown}).pathname;
    if (typeof pathname === "string") return {...target, pathname: validateUrl(pathname)};
  }
  return target;
}

/** Validates a string form action while preserving server-action functions. */
export function validateFormTarget<T>(target: T): T {
  return typeof target === "string" ? validateUrl(target) as T : target;
}

/** Validates a string image source while preserving trusted StaticImport objects. */
export function validateImageSource<T>(source: T): T {
  return typeof source === "string" ? validateUrl(source) as T : source;
}
