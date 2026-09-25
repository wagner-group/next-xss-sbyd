import {compiledProbe} from "../app/compiled";
import {useEffect, useState} from "react";
import {probes as esm, safeElement as esmSafe} from "jsx-probe-esm";
import {probes as cjs, safeElement as cjsSafe} from "jsx-probe-cjs";
import {htmlEscape, SafeBlock} from "next-xss-sbyd";
export default function Legacy() {
  const [ready, setReady] = useState(false);
  useEffect(() => {setReady(true);}, []);
  return <main>
    <pre id="legacy-compiled">{compiledProbe()}</pre>
    <pre id="legacy-esm">{JSON.stringify(esm())}</pre>
    <pre id="legacy-cjs">{JSON.stringify(cjs())}</pre>
    {esmSafe(htmlEscape("<b>safe esm</b>"), "legacy-safe-esm")}
    {cjsSafe(htmlEscape("<b>safe cjs</b>"), "legacy-safe-cjs")}
    <SafeBlock id="legacy-safe-block" html={htmlEscape("<b>safe block</b>")} />
    <output id="legacy-ready">{ready ? "ready" : "waiting"}</output>
  </main>;
}

export function getServerSideProps() { return {props: {}}; }
