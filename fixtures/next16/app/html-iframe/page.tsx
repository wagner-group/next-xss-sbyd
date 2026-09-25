import {SafeHtmlIframe} from "next-xss-sbyd/safe-html-iframe";
import ClientPreview from "./client";

export const dynamic = "force-dynamic";

/** Exercise the react-server export alongside a real client boundary. */
export default function Page() {
  return <main>
    <SafeHtmlIframe id="server-frame" value={'<p>Server preview</p><script>parent.attacked=true</script>'} title="Server preview" />
    <ClientPreview />
  </main>;
}
