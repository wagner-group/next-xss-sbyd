"use client";

import {createContext, useContext, useEffect, useState} from "react";
import Link from "next/link";
import {SafeStyleBlock, safeStyleSheet} from "next-xss-sbyd";
import type {CspNonce} from "next-xss-sbyd/csp";
import styles from "./notice.module.css";

const NonceContext = createContext<CspNonce | undefined>(undefined);

/** The retained layout owns the nonce accepted by this document's CSP. */
export function DocumentNonce({nonce, children}: {nonce: CspNonce; children: React.ReactNode}) {
  // Navigation can supply a new prop, but the active document keeps its original CSP.
  const [documentNonce] = useState(nonce);
  return <NonceContext.Provider value={documentNonce}>{children}</NonceContext.Provider>;
}

/** Show server-rendered React styles and state-driven updates. */
export function StyleExamples({next = false}: {next?: boolean}) {
  const nonce = useContext(NonceContext);
  const [width, setWidth] = useState(100);
  const [hydrated, setHydrated] = useState(false);
  const [inserted, setInserted] = useState(false);
  useEffect(function markHydrated() { setHydrated(true); }, []);
  return <section data-hydrated={hydrated}>
    <div className={styles.notice} data-style-example="module">Saved with a CSS Module</div>
    <div className="fixed-notice" data-style-example="fixed">Saved with a fixed stylesheet</div>
    <div style={{width}} className={styles.dynamic} data-style-example="dynamic">Measured size</div>
    <button onClick={() => setWidth(173)}>Resize</button>
    <button onClick={() => setInserted(true)}>Insert fixed stylesheet</button>
    {inserted && <SafeStyleBlock nonce={nonce} css={safeStyleSheet`.late-notice { color: blue; }`} />}
    <div className="late-notice">Later style insertion</div>
    <Link href={next ? "/styles" : "/styles/next"} prefetch={false}>{next ? "First style page" : "Next style page"}</Link>
  </section>;
}
