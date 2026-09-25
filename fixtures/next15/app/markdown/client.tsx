"use client";

import {Component, useEffect, useState, type ReactNode} from "react";
import {SafeMarkdown} from "next-xss-sbyd/markdown";
import {markdownSource} from "./source";

/** Catch render-time rejection and display escaped application fallback text. */
class MarkdownBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = {failed: false};
  /** React invokes this for a failing descendant render. */
  static getDerivedStateFromError() { return {failed: true}; }
  /** Keep the fallback in a text child, never an HTML sink. */
  render() {
    return this.state.failed
      ? <p id="markdown-error-fallback">{"Cannot display <img src=x onerror=alert(1)>"}</p>
      : this.props.children;
  }
}

/** Reject new browser input inside a real React error boundary. */
function MarkdownLimitExample() {
  const [source, setSource] = useState("Valid preview");
  function exceedLimit() { setSource("x".repeat(32769)); }
  return <section id="markdown-limit-example">
    <button onClick={exceedLimit}>Exceed Markdown limit</button>
    <MarkdownBoundary><SafeMarkdown>{source}</SafeMarkdown></MarkdownBoundary>
  </section>;
}

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
    <MarkdownLimitExample />
  </section>;
}
