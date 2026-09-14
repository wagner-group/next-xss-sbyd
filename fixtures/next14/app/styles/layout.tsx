import {SafeStyleBlock, safeStyleSheet} from "next-xss-sbyd";
import {getNonce} from "next-xss-sbyd/csp";
import {DocumentNonce} from "./client";

/** Retain the document nonce and shared fixed rules across Link navigation. */
export default async function StyleLayout({children}: {children: React.ReactNode}) {
  const nonce = await getNonce();
  return <DocumentNonce nonce={nonce}>
    <SafeStyleBlock nonce={nonce} css={safeStyleSheet`.fixed-notice { color: green; padding: 8px; }`} />
    {children}
  </DocumentNonce>;
}
