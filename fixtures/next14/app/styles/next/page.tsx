import {getNonce} from "next-xss-sbyd/csp";
import {StyleExamples} from "../client";

/** Exercise a fresh request while the original document policy remains active. */
export default async function Page() {
  const nonce = await getNonce();
  return <main data-request-nonce={nonce}><h1>Next style page</h1><StyleExamples next /></main>;
}
