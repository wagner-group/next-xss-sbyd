"use client";

import {useEffect, useRef, useState} from "react";
import {SafeHtmlIframe} from "next-xss-sbyd/safe-html-iframe";

/** Exercise hydration, refs, unrelated state and document updates. */
export default function ClientPreview() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [count, setCount] = useState(0);
  const [value, setValue] = useState('<p>Client preview</p><script>parent.attacked=true</script>');
  useEffect(function checkRef() { setReady(frame.current instanceof HTMLIFrameElement); }, []);
  return <section>
    <p id="frame-ready">{ready ? "ready" : "waiting"}</p>
    <button onClick={() => setCount(count + 1)}>Parent render {count}</button>
    <button onClick={() => setValue("<p>Updated preview</p>")}>Update document</button>
    <SafeHtmlIframe id="client-frame" ref={frame} value={value} title="Client preview" />
  </section>;
}
