import {getNonce} from "next-xss-sbyd/csp";
import {StyleProviders} from "./providers";
import "sonner/dist/styles.css";
import "./styles.css";

/** Supplies the request nonce at the server/client boundary. */
export default async function StyleLayout({children}: {children: React.ReactNode}) {
  return <StyleProviders nonce={await getNonce()}>{children}</StyleProviders>;
}
