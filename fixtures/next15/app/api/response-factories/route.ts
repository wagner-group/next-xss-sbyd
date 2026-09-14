import {NextResponse} from "next/server";
import {htmlEscape, SafeResponse} from "next-xss-sbyd";
import {isGuardInstalled} from "next-xss-sbyd/enforce";

export const dynamic = "force-dynamic";

/** Exercises native and framework factories under both production installation methods. */
export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const mode = params.get("factory");
  if (mode === "guard") return Response.json({installed: isGuardInstalled()});
  if (mode === "safe-global") return new SafeResponse(htmlEscape("<safe>"));
  if (mode === "raw-global") return new Response("<unsafe>", {headers: {"content-type": "text/html"}});
  if (mode === "json-content-type" || mode === "next-json-content-type") {
    const payload = "<script>globalThis.__JSON_XSS__ = true</script>";
    const data = params.get("shape") === "object" ? {value: payload} : payload;
    const init = {headers: {"content-type": params.get("contentType") ?? "application/json"}};
    return mode === "next-json-content-type" ? NextResponse.json(data, init) : Response.json(data, init);
  }
  if (mode === "redirect") return Response.redirect("https://example.test/export", 307);
  if (mode === "next-redirect") return NextResponse.redirect("https://example.test/export", 308);
  if (mode === "next-json") return NextResponse.json({error: "invalid format"}, {status: 400});
  if (mode === "identity") {
    const error = Response.error();
    return new Response(JSON.stringify({
      response: error instanceof Response,
      nextResponse: error instanceof NextResponse,
      status: error.status,
      type: error.type,
    }), {headers: {"content-type": "application/json"}});
  }
  return Response.json({error: "invalid format"}, {status: 400});
}
