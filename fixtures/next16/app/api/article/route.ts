import {withSafeRouteHandler} from "next-xss-sbyd/route-handler";
import {NextResponse} from "next/server";

/** Return an untrusted JSON article, with a controllable delayed response. */
export const GET = withSafeRouteHandler(async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name") ?? "first";
  await new Promise((resolve) => setTimeout(resolve, name === "slow" ? 700 : 100));
  return NextResponse.json({html: `<p>Remember the ${name} article.</p><mark data-highlight-id="saved-record">Imported marker</mark><img src="/article.png" alt="A mountain" onerror="globalThis.__LIFECYCLE_XSS__=1"><audio src="/lesson.wav"></audio><video src="/demo.webm"></video><script>globalThis.__LIFECYCLE_XSS__=1</script>`});
});
