import {getNonce} from "next-xss-sbyd/csp";
import "../csp-styles/styles.css";

/** Serves original library output under the default policy. */
export default async function DiagnosticsLayout({children}: {children: React.ReactNode}) {
  return <div data-diagnostic-nonce={await getNonce()}>{children}</div>;
}
