import {SafeMarkdown} from "next-xss-sbyd/markdown";
import MarkdownClient from "./client";
import {markdownSource} from "./source";

export const dynamic = "force-dynamic";

/** Exercise server components and client components with identical untrusted input. */
export default function MarkdownPage() {
  return <main>
    <article id="server-markdown"><SafeMarkdown>{markdownSource}</SafeMarkdown></article>
    <MarkdownClient />
  </main>;
}
