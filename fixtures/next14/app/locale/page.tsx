import {getNonce} from "next-xss-sbyd/csp";
export default async function LocalePage() { const nonce = await getNonce(); return <main data-nonce={nonce}>localized-next14</main>; }
