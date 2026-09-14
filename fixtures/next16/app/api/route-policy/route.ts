import {cookies} from "next/headers";
import {htmlEscape, SafeResponse, SafeNextResponse} from "next-xss-sbyd";
import {withSafeRouteHandler} from "next-xss-sbyd/route-handler";

export const dynamic = "force-dynamic";

/** Exercises outgoing bodies separately from ordinary Response containers. */
export const GET = withSafeRouteHandler(async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const mode = query.get("mode") ?? "safe";
  const raw = "<script>globalThis.__ROUTE_XSS__=true</script>";
  const bytes = new TextEncoder().encode(raw);
  if (mode === "blob") return new Response(new Blob([bytes], {type: "text/html"}));
  if (mode === "missing") return new Response(bytes);
  if (mode === "svg") return new Response(new Blob([bytes], {type: "image/svg+xml"}));
  if (mode === "forward") return fetch(query.get("upstream")!);
  if (mode === "cached-fetch") {
    const response = await fetch(query.get("upstream")!, {cache: "force-cache"});
    return Response.json({text: await response.text()});
  }
  if (mode === "converter") {
    return Response.json({text: await new Response(new Response(bytes).body).text()});
  }
  if (mode === "sse") {
    return new Response(new TextEncoder().encode("data: ready\n\n"), {headers: {"content-type": "text/event-stream"}});
  }
  if (mode === "mutated") {
    const response = new Response(bytes, {headers: {"content-type": "application/octet-stream"}});
    response.headers.set("content-type", "text/html");
    return response;
  }
  if (mode === "cookie") (await cookies()).set("safe-route", "yes");
  const response = mode === "next" ? new SafeNextResponse(htmlEscape(raw)) : new SafeResponse(htmlEscape(raw));
  if (mode === "clone") return response.clone().clone();
  if (mode === "rewrap") return new Response(response.body, {headers: response.headers});
  return response;
}, "app/api/route-policy/route.ts GET");
