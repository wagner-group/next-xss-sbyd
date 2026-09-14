import Document, {Head, Html, Main, NextScript, type DocumentContext, type DocumentProps} from "next/document";

/** Forward the middleware nonce to Pages Router framework scripts. */
export default function FixtureDocument({nonce}: DocumentProps & {nonce?: string}) {
  return <Html><Head nonce={nonce} /><body><Main /><NextScript nonce={nonce} /></body></Html>;
}

FixtureDocument.getInitialProps = async function getInitialProps(context: DocumentContext) {
  const initial = await Document.getInitialProps(context);
  const nonce = context.req?.headers["x-nonce"];
  return {...initial, nonce: typeof nonce === "string" ? nonce : undefined};
};
