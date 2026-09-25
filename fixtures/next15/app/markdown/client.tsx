"use client";

import {useEffect, useState} from "react";
import {SafeMarkdown} from "next-xss-sbyd/markdown";
import {markdownSource} from "./source";

/** Render the same source during SSR/hydration, then replace it from browser state. */
export default function MarkdownClient() {
  const [ready, setReady] = useState(false);
  const [source, setSource] = useState(markdownSource);
  useEffect(function markReady() { setReady(true); }, []);
  function updateSource() { setSource("# Updated document\n\n" + markdownSource); }
  return <section>
    <p id="markdown-ready">{ready ? "ready" : "waiting"}</p>
    <button onClick={updateSource}>Update Markdown</button>
    <article id="client-markdown"><SafeMarkdown>{source}</SafeMarkdown></article>
  </section>;
}
