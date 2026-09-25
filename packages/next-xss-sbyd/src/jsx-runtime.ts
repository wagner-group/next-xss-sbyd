import {Fragment, jsx as reactJsx, jsxs as reactJsxs} from "react/jsx-runtime";
import type {JSX, Key, ReactElement} from "react";
import {guardJsxProps} from "./jsx-guard.js";
import {validateIntrinsicUrlProps} from "./url-sinks.js";

type Props = Record<string, unknown>;

function validated(type: unknown, props: Props): Props {
  if (typeof type !== "string") return props;
  return validateIntrinsicUrlProps(type, guardJsxProps(type, props));
}

/** Creates a JSX element after validating intrinsic URL sinks. */
export function jsx(type: unknown, props: Props, key?: Key): ReactElement {
  return reactJsx(type as never, validated(type, props), key);
}

/** Creates a multi-child JSX element after validating intrinsic URL sinks. */
export function jsxs(type: unknown, props: Props, key?: Key): ReactElement {
  return reactJsxs(type as never, validated(type, props), key);
}

export {Fragment};
export type {JSX};

// Match the default import provided by React's CommonJS runtime entry points.
export default {Fragment, jsx, jsxs};
