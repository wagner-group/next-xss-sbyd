import {Fragment, jsxDEV as reactJsxDEV} from "react/jsx-dev-runtime";
import type {JSX, Key, ReactElement} from "react";
import {guardJsxProps} from "./jsx-guard.js";
import {validateIntrinsicUrlProps} from "./url-sinks.js";

type Props = Record<string, unknown>;

/** Creates a development JSX element after validating intrinsic URL sinks. */
export function jsxDEV(
  type: unknown,
  props: Props,
  key: Key | undefined,
  isStaticChildren: boolean,
  source?: unknown,
  self?: unknown,
): ReactElement {
  const validated = typeof type === "string" ? validateIntrinsicUrlProps(type, guardJsxProps(type, props)) : props;
  return reactJsxDEV(type as never, validated, key, isStaticChildren, source as never, self);
}

export {Fragment};
export type {JSX};
