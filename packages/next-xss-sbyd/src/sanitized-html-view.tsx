import {forwardRef} from "react";
import type {ForwardRefExoticComponent, RefAttributes} from "react";
import {renderSanitizedHtmlView} from "./internal/sanitized-html-view.js";
import type {SanitizedHtmlViewContentProps} from "./internal/sanitized-html-view.js";

type Container = NonNullable<SanitizedHtmlViewContentProps["as"]>;

export type SanitizedHtmlViewProps = {
  [Tag in Container]: Omit<SanitizedHtmlViewContentProps, "as"> &
    (Tag extends "div" ? {readonly as?: Tag} : {readonly as: Tag}) &
    RefAttributes<HTMLElementTagNameMap[Tag]>;
}[Container];

/** Sanitizes untrusted HTML on every render and forwards a ref to its inert container. */
export const SanitizedHtmlView = forwardRef<HTMLElement, SanitizedHtmlViewContentProps>(
  renderSanitizedHtmlView,
) as ForwardRefExoticComponent<SanitizedHtmlViewProps>;
SanitizedHtmlView.displayName = "SanitizedHtmlView";
