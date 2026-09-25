"use client";

import {createElement, forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef} from "react";
import {prepareFrame, sanitizeFrame} from "./internal/sanitized-frame.js";
import type {SafeHtmlIframeProps} from "./internal/sanitized-frame.js";

export type {SafeHtmlIframeProps} from "./internal/sanitized-frame.js";

const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Sanitizes an untrusted document into an opaque-origin frame with no sandbox permissions. */
export const SafeHtmlIframe = forwardRef<HTMLIFrameElement, SafeHtmlIframeProps>(
  function SafeHtmlIframe(props, ref) {
    const frameProps = prepareFrame(props);
    const html = useMemo(() => sanitizeFrame(props.value), [props.value]);
    const frameRef = useRef<HTMLIFrameElement>(null);
    const setFrame = useCallback(function setFrame(frame: HTMLIFrameElement | null) {
      frameRef.current = frame;
      if (typeof ref === "function") return ref(frame);
      else if (ref !== null) ref.current = frame;
    }, [ref]);
    useBrowserLayoutEffect(function installDocument() {
      // React stringifies srcDoc. This assertion only accommodates lib.dom;
      // the actual sink receives TrustedHTML, once per changed input value.
      frameRef.current!.srcdoc = html as string;
    }, [html]);
    return createElement("iframe", {
      ...frameProps,
      ref: setFrame,
      // SSR is a string serialization, not a browser DOM sink. On hydration the
      // layout effect installs the browser-sanitized value again, once.
      ...(typeof window === "undefined" ? {srcDoc: String(html)} : {}),
      // Only needed because srcDoc is omitted from client props for Trusted Types.
      // React also suppresses other attribute mismatches on this element.
      suppressHydrationWarning: true,
    });
  },
);
