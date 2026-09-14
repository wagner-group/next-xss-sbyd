import {Suspense, createElement} from "react";
import {
  SafeBlock,
  SafeJsonLdScript,
  SafeJsonScript,
  SafeScriptBlock,
  SafeStyleBlock,
  htmlEscape,
  safeScript,
  safeStyleSheet,
} from "next-xss-sbyd";
import {getNonce} from "next-xss-sbyd/csp";

const breakout = "</script><script>globalThis.__XSS_SBYD_PAYLOAD__='executed'</script>";

async function DelayedContent() {
  await new Promise((resolve) => setTimeout(resolve, 5));
  return <span data-suspense="resolved">suspense-ready</span>;
}
const Suspended = DelayedContent as unknown as () => JSX.Element;

export default async function Page() {
  const nonce = await getNonce();
  return <main data-nonce={nonce}>
    next14-app
    <SafeBlock html={htmlEscape("sanitized-rich-text")} />
    <SafeJsonScript id="fixture-state" data={{breakout}} />
    <SafeJsonLdScript data={{"@context": "https://schema.org", name: breakout}} />
    <SafeScriptBlock nonce={nonce} script={safeScript`globalThis.__NONCE_PROBE__=true`} />
    <SafeStyleBlock nonce={nonce} css={safeStyleSheet`main { display: block; }`} />
    <Suspense fallback={<span data-suspense="fallback">waiting</span>}>
      {createElement(Suspended)}
    </Suspense>
  </main>;
}
