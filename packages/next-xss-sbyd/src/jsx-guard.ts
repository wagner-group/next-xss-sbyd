import {isHtml} from "safevalues";
import {unwrapHtml} from "./internal/unwrap.js";

type Props = Record<string, unknown>;

function isSafeInnerHtml(value: unknown): value is {__html: Parameters<typeof unwrapHtml>[0]} {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.hasOwn(value, "__html") && isHtml((value as {__html?: unknown}).__html);
}

function violationMessage(element: unknown, prop: string): string {
  let elementName = "component";
  if (typeof element === "string") elementName = element;
  else if (typeof element === "function") {
    const named = element as {displayName?: unknown; name?: unknown};
    if (typeof named.displayName === "string") elementName = named.displayName;
    else if (typeof named.name === "string") elementName = named.name;
  }
  else if (typeof element === "object" && element !== null) {
    const named = element as {displayName?: unknown; name?: unknown};
    if (typeof named.displayName === "string") elementName = named.displayName;
    else if (typeof named.name === "string") elementName = named.name;
  }
  return `${prop} on <${elementName}> requires a SafeHtml value; build one with htmlEscape() or sanitizeUserHtml().`;
}

/** Authenticates raw-HTML props and unwraps safe values for React. */
export function guardJsxProps(element: unknown, original: Props): Props {
  let guarded = original;
  for (const prop of Object.keys(original)) {
    const lower = prop.toLowerCase();
    const value = original[prop];
    const isSrcDoc = lower === "srcdoc";
    const isDangerous = lower.startsWith("dangerously");
    if (!isSrcDoc && !isDangerous) continue;
    if (value === undefined || value === null) continue;

    if (isSrcDoc && isHtml(value)) {
      guarded = guarded === original ? {...original} : guarded;
      guarded[prop] = unwrapHtml(value);
      continue;
    }
    if (prop === "dangerouslySetInnerHTML" && isSafeInnerHtml(value)) {
      guarded = guarded === original ? {...original} : guarded;
      guarded[prop] = {...value, __html: unwrapHtml(value.__html)};
      continue;
    }

    throw new TypeError(violationMessage(element, prop));
  }
  return guarded;
}
