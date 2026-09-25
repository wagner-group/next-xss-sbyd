import {compiledProbe} from "../app/compiled";
import {useEffect, useState} from "react";
import {probes as esm, safeElement as esmSafe} from "jsx-probe-esm";
import {probes as cjs, safeElement as cjsSafe} from "jsx-probe-cjs";
import {htmlEscape, SafeBlock} from "next-xss-sbyd";
import {probes as untranspiledEsm} from "jsx-probe-untranspiled-esm";
import {probes as untranspiledCjs} from "jsx-probe-untranspiled-cjs";
export default function Legacy({externalEsm, externalCjs}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {setReady(true);}, []);
  return <main>
    <pre id="legacy-untranspiled-esm">{JSON.stringify(externalEsm)}</pre>
    <pre id="legacy-untranspiled-cjs">{JSON.stringify(externalCjs)}</pre>
    <pre id="legacy-compiled">{compiledProbe()}</pre>
    <pre id="legacy-esm">{JSON.stringify(esm())}</pre>
    <pre id="legacy-cjs">{JSON.stringify(cjs())}</pre>
    {esmSafe(htmlEscape("<b>safe esm</b>"), "legacy-safe-esm")}
    {cjsSafe(htmlEscape("<b>safe cjs</b>"), "legacy-safe-cjs")}
    <SafeBlock id="legacy-safe-block" html={htmlEscape("<b>safe block</b>")} />
    <output id="legacy-ready">{ready ? "ready" : "waiting"}</output>
  </main>;
}

// Run only on the server so the unchecked SSR observations survive hydration.
export function getServerSideProps() {
  return {props: {externalEsm: untranspiledEsm(), externalCjs: untranspiledCjs()}};
}
