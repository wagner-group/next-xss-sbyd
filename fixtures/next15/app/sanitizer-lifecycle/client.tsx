"use client";

import {useEffect, useMemo, useRef, useState} from "react";
import {SafeBlock, type SafeHtml} from "next-xss-sbyd";
import {sanitizeUserHtml} from "next-xss-sbyd/sanitize";

type SavedRange = {start: number; end: number; record: string};
const saved: SavedRange[] = [{start: 0, end: 8, record: "saved-record"}];

/** Restore only application-owned ranges, retaining no authority from imported markup. */
function restore(container: HTMLElement, ranges: SavedRange[], activate: (id: string) => void) {
  const records = new WeakMap<Element, string>();
  const owned: HTMLElement[] = [];
  for (const savedRange of ranges) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let offset = 0;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const length = node.textContent?.length ?? 0;
      if (savedRange.start >= offset && savedRange.end <= offset + length) {
        const range = document.createRange();
        range.setStart(node, savedRange.start - offset);
        range.setEnd(node, savedRange.end - offset);
        const marker = document.createElement("mark");
        range.surroundContents(marker);
        records.set(marker, savedRange.record);
        owned.push(marker);
        break;
      }
      offset += length;
    }
  }
  function onClick(event: MouseEvent) {
    const marker = event.target instanceof Element ? event.target.closest("mark") : null;
    const record = marker && records.get(marker);
    if (record) activate(record);
  }
  container.addEventListener("click", onClick);
  return function cleanup() {
    container.removeEventListener("click", onClick);
    for (const marker of owned) {
      if (container.contains(marker)) marker.replaceWith(...Array.from(marker.childNodes));
    }
    container.normalize();
  };
}

/** Exercise universal imports during SSR/render and browser-owned article readiness. */
export default function SanitizerLifecycle() {
  const rendered = useMemo(() => sanitizeUserHtml('<p>render-clean <mark>visible</mark></p><img src="data:text/html,bad" onerror="globalThis.__LIFECYCLE_XSS__=1">'), []);
  const [article, setArticle] = useState<SafeHtml | null>(null);
  const [request, setRequest] = useState({name: "first", serial: 0});
  const [revision, setRevision] = useState(0);
  const [mounted, setMounted] = useState(true);
  const [active, setActive] = useState("none");
  const [activations, setActivations] = useState(0);
  const [error, setError] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setArticle(null);
    setError(false);
    async function load() {
      try {
        const response = await fetch(`/api/article?name=${request.name}`, {signal: controller.signal});
        const value: unknown = await response.json();
        if (!response.ok || typeof value !== "object" || value === null || !("html" in value) || typeof value.html !== "string") throw new Error("Invalid article");
        const clean = sanitizeUserHtml(value.html);
        if (live) setArticle(clean);
      } catch (cause) {
        if (live && !controller.signal.aborted) setError(true);
      }
    }
    void load();
    return () => {live = false; controller.abort();};
  }, [request]);
  useEffect(() => {
    if (!article || !mounted || !container.current) return;
    return restore(container.current, saved, (record) => {
      setActive(record);
      setActivations((count) => count + 1);
    });
  }, [article, revision, mounted]);
  return <main>
    <section id="render-clean"><SafeBlock html={rendered} /></section>
    <button onClick={() => setRequest((old) => ({name: "second", serial: old.serial + 1}))}>Replace article</button>
    <button onClick={() => setRequest((old) => ({name: "slow", serial: old.serial + 1}))}>Slow article</button>
    <button onClick={() => setRevision((old) => old + 1)}>Restore again</button>
    <button onClick={() => setMounted((old) => !old)}>Toggle article</button>
    <output id="active-record">{active}</output><output id="activations">{activations}</output>
    {error ? <p id="article-error">Failed</p> : article === null ? <p id="article-loading">Loading…</p> : mounted ? <div id="article" ref={container}><SafeBlock html={article} /></div> : null}
  </main>;
}
