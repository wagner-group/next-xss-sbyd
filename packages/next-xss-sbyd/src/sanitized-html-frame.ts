"use client";

import {createElement, forwardRef, useCallback} from "react";
import {prepareFrame} from "./internal/sanitized-frame.js";
import type {SanitizedHtmlFrameProps} from "./internal/sanitized-frame.js";

export type {SanitizedHtmlFrameProps} from "./internal/sanitized-frame.js";

/** Sanitizes an untrusted document into an opaque-origin frame with no sandbox permissions. */
export const SanitizedHtmlFrame = forwardRef<HTMLIFrameElement, SanitizedHtmlFrameProps>(
  function SanitizedHtmlFrame(props, ref) {
    const {html, props: frameProps} = prepareFrame(props);
    const setFrame = useCallback(function setFrame(frame: HTMLIFrameElement | null) {
      if (frame !== null) {
        // React coerces srcDoc attributes to strings. Assign the authenticated DOM
        // value directly so TT enforcement works without a default policy. This
        // type assertion accommodates lib.dom's string-only declaration; it does
        // not convert the TrustedHTML object at runtime.
        frame.srcdoc = html as string;
      }
      if (typeof ref === "function") return ref(frame);
      else if (ref !== null) ref.current = frame;
    }, [html, ref]);
    return createElement("iframe", {
      ...frameProps,
      ref: setFrame,
      // SSR is a string serialization, not a browser DOM sink. On hydration the
      // callback authenticates and installs the browser-sanitized value again.
      ...(typeof window === "undefined" ? {srcDoc: String(html)} : {}),
      suppressHydrationWarning: true,
    });
  },
);
