"use client";

import {useState} from "react";
import {setNonce} from "get-nonce";
import {ThemeProvider} from "next-themes";

/** Keeps the document nonce stable across App Router navigation and refresh. */
export function StyleProviders({nonce, children}: {nonce: string; children: React.ReactNode}) {
  const [documentNonce] = useState(nonce);
  // Initialize before child effects insert styles; a parent effect runs too late.
  // Only browser state is global: never leak a request nonce through SSR state.
  if (typeof window !== "undefined") setNonce(documentNonce);
  return <ThemeProvider nonce={documentNonce} defaultTheme="light" enableSystem={false} disableTransitionOnChange>
    <div data-testid="style-provider" data-document-nonce={documentNonce}>{children}</div>
  </ThemeProvider>;
}
