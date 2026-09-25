import {compiledProbe} from "./compiled";
import {probes as esm} from "jsx-probe-esm";
import {probes as cjs} from "jsx-probe-cjs";
import external from "jsx-probe-external";
import Client from "./client";
export const dynamic = "force-dynamic";
export default function Page() {
  return <main>
    <pre id="server-compiled">{compiledProbe()}</pre>
    <pre id="server-esm">{JSON.stringify(esm())}</pre>
    <pre id="server-cjs">{JSON.stringify(cjs())}</pre>
    <pre id="external">{external()}</pre>
    <Client />
  </main>;
}
