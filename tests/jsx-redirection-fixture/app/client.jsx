"use client";
import {compiledProbe} from "./compiled";
import {useEffect, useRef, useState} from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import {jsx} from "react/jsx-runtime";
import {probes as esm} from "jsx-probe-esm";
import {probes as cjs} from "jsx-probe-cjs";
import {htmlEscape, SafeBlock} from "next-xss-sbyd";
import {SafeMarkdown} from "next-xss-sbyd/markdown";

export default function Client() {
  const [ready, setReady] = useState(false);
  const [count, setCount] = useState(0);
  const [lazy, setLazy] = useState(null);
  const ref = useRef(null);
  useEffect(() => { setReady(ref.current?.tagName === "BUTTON"); }, []);
  async function load() {
    const module = await import("jsx-probe-lazy");
    setLazy(module.probes());
  }
  return <section>
    <pre id="client-compiled">{compiledProbe()}</pre>
    <pre id="client-esm">{JSON.stringify(esm())}</pre>
    <pre id="client-cjs">{JSON.stringify(cjs())}</pre>
    <output id="ready">{ready ? "ready" : "waiting"}</output>
    <button ref={ref} id="update" onClick={() => setCount(count + 1)}>Count {count}</button>
    <button id="load" onClick={load}>Load dependency</button>
    <pre id="lazy">{lazy ? JSON.stringify(lazy) : "waiting"}</pre>
    <SafeBlock id="safe-block" html={htmlEscape("<b>escaped</b>")} />
    {jsx("div", {id: "safe-direct", dangerouslySetInnerHTML: {__html: htmlEscape("<b>direct</b>")}})}
    <div id="markdown"><SafeMarkdown>{"# Heading\n\n[local](/?navigation=yes)\n\n<script>bad()</script>\n\n![alt](/favicon.ico)"}</SafeMarkdown></div>
    <div id="react-markdown"><ReactMarkdown>{"![safe](/favicon.ico)\n\n![rejected](javascript:alert%281%29)"}</ReactMarkdown></div>
    <Link id="next-link" href="/?navigation=yes">Navigate</Link>
  </section>;
}
