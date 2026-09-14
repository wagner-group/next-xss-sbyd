import {getNonce} from "next-xss-sbyd/csp";
import {StyleExamples} from "./client";

/** Serve application examples with a measurable, styled SSR baseline. */
export default async function Page() {
  const nonce = await getNonce();
  return <main data-request-nonce={nonce}><h1>First style page</h1><StyleExamples /></main>;
}
