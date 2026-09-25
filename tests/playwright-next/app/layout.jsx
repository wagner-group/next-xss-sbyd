import Link from "next/link";
import {getNonce} from "next-xss-sbyd/csp";
import Counter from "./counter";
import "./styles.css";

/** Render persistent nonce-authorized content around the navigation targets. */
export default async function Layout({children}) {
  const nonce = await getNonce();
  return <html lang="en"><body>
    <script id="authorized" nonce={nonce}
      dangerouslySetInnerHTML={{__html: 'document.documentElement.dataset.authorized = "yes"'}} />
    <nav><Link href="/" prefetch={false}>Home</Link> <Link href="/second" prefetch={false}>Second</Link></nav>
    <Counter />
    {children}
  </body></html>;
}
