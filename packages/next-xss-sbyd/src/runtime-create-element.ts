import {createElement as reactCreateElement} from "react";
import type {Attributes, ReactElement, ReactNode} from "react";
import {guardJsxProps} from "./jsx-guard.js";
import {validateIntrinsicUrlProps} from "./url-sinks.js";

/** React.createElement-compatible fallback that validates intrinsic URL sinks. */
export function createElement(
  type: unknown,
  props?: (Attributes & Record<string, unknown>) | null,
  ...children: ReactNode[]
): ReactElement {
  const original = props ?? {};
  const validated = typeof type === "string" ? validateIntrinsicUrlProps(type, guardJsxProps(type, original)) : original;
  return reactCreateElement(type as never, validated, ...children);
}
