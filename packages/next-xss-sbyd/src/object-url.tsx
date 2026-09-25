"use client";

import {useEffect, useRef} from "react";
import type {ReactNode} from "react";
import {assertPassiveContentType, parsedMediaType} from "./passive-content.js";

const rasterTypes = new Set(["image/png", "image/jpeg", "image/gif"]);
declare const passiveObjectUrlBrand: unique symbol;
export type PassiveObjectUrlUse = "download" | "raster-preview";

/** Browser capability. Copying its fields does not copy its authority. */
export interface PassiveObjectUrl {
  readonly [passiveObjectUrlBrand]: true;
  readonly url: string;
  readonly mediaType: string;
  readonly use: PassiveObjectUrlUse;
  readonly revoked: boolean;
}

type State = {url: string; use: PassiveObjectUrlUse; revoked: boolean};
const handles = new WeakMap<PassiveObjectUrl, State>();

function stateOf(handle: PassiveObjectUrl, use?: PassiveObjectUrlUse): State {
  const state = handles.get(handle);
  if (!state || (use !== undefined && (state.revoked || state.use !== use))) {
    throw new TypeError("Expected an authentic, live passive object URL for this use");
  }
  return state;
}

/** Creates a browser-only capability; MIME declarations do not validate file bytes. */
export function createPassiveObjectUrl(blob: Blob, use: PassiveObjectUrlUse = "download"): PassiveObjectUrl {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new TypeError("Passive object URLs require a browser document");
  }
  // Native accessors reject impostors and avoid user-overridden Blob.type getters.
  const type = Object.getOwnPropertyDescriptor(Blob.prototype, "type")!.get!.call(blob) as string;
  assertPassiveContentType(type, "Passive object URL");
  const mediaType = parsedMediaType(type)!;
  if (!rasterTypes.has(mediaType) || (use !== "download" && use !== "raster-preview")) {
    throw new TypeError("Passive object URLs support PNG, JPEG and GIF downloads or raster previews only");
  }
  // eslint-disable-next-line xss-sbyd/no-object-url -- This is the checked implementation; native Blob MIME and permitted use were validated above.
  const url = URL.createObjectURL(blob);
  const state: State = {url, use, revoked: false};
  const handle = Object.freeze({url, mediaType, use, get revoked() { return state.revoked; }}) as PassiveObjectUrl;
  handles.set(handle, state);
  return handle;
}

/** Revokes once; download cleanup waits a task so a pending click can start its default action. */
export function revokePassiveObjectUrl(handle: PassiveObjectUrl): void {
  const state = stateOf(handle);
  if (state.revoked) return;
  state.revoked = true;
  if (state.use === "download") {
    setTimeout(() => URL.revokeObjectURL(state.url), 0);
  } else {
    URL.revokeObjectURL(state.url);
  }
}

/** Attaches an authenticated raster preview; the returned cleanup releases ownership. */
export function attachPassiveObjectUrlPreview(image: HTMLImageElement, handle: PassiveObjectUrl): () => void {
  const state = stateOf(handle, "raster-preview");
  if (!(image instanceof HTMLImageElement)) throw new TypeError("Expected an HTML image element");
  image.src = state.url;
  return function detachPreview() {
    if (image.getAttribute("src") === state.url) image.removeAttribute("src");
    revokePassiveObjectUrl(handle);
  };
}

/** Attaches a download-only link; keep its handle alive until the user is done with it. */
export function attachPassiveObjectUrlDownload(anchor: HTMLAnchorElement, handle: PassiveObjectUrl, filename: string): () => void {
  const state = stateOf(handle, "download");
  if (!(anchor instanceof HTMLAnchorElement) || typeof filename !== "string" || !filename) {
    throw new TypeError("Expected an HTML anchor and a nonempty download filename");
  }
  anchor.download = filename;
  anchor.href = state.url;
  return function detachDownload() {
    // Cleanup may run in an ancestor capture listener, before this anchor sees
    // its click. Preserve href until the default action, regardless of listener order.
    setTimeout(() => {
      if (anchor.getAttribute("href") === state.url) anchor.removeAttribute("href");
    }, 0);
    revokePassiveObjectUrl(handle);
  };
}

/** Owns a Blob preview from committed mount through replacement/unmount (including Strict Mode). */
export function PassiveObjectUrlPreview({blob, alt}: {blob: Blob; alt: string}) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(function mountPreview() {
    const handle = createPassiveObjectUrl(blob, "raster-preview");
    try {
      return attachPassiveObjectUrlPreview(ref.current!, handle);
    } catch (error) {
      revokePassiveObjectUrl(handle);
      throw error;
    }
  }, [blob]);
  return <img ref={ref} alt={alt} />;
}

/** Owns a downloadable Blob; allocation happens after commit, never during render. */
export function PassiveObjectUrlDownload({blob, filename, children}: {blob: Blob; filename: string; children: ReactNode}) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(function mountDownload() {
    const handle = createPassiveObjectUrl(blob);
    try {
      return attachPassiveObjectUrlDownload(ref.current!, handle, filename);
    } catch (error) {
      revokePassiveObjectUrl(handle);
      throw error;
    }
  }, [blob, filename]);
  return <a ref={ref}>{children}</a>;
}
