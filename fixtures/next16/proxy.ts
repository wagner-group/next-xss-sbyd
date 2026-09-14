import {withXssSbydHeaders} from "next-xss-sbyd/csp";
import {NextRequest, NextResponse} from "next/server";

async function inner(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("mode");
  if (mode === "rewrite") return NextResponse.rewrite(new URL("/locale", request.url));
  if (mode === "redirect") return NextResponse.redirect(new URL("/", request.url));
  if (mode === "direct") return new NextResponse("direct", {status: 202});
  if (mode === "throw") throw new Error("fixture error");
  const response = NextResponse.next();
  if (mode === "cookie") response.cookies.set("fixture", "yes");
  return response;
}

const enforce = withXssSbydHeaders(inner, {reportUri: "/api/csp-report"});
const reportOnly = withXssSbydHeaders(inner, {mode: "report-only", reportUri: "/api/csp-report"});
export const proxy = (request: NextRequest, event: Parameters<typeof enforce>[1]) =>
  request.nextUrl.searchParams.has("report-only") ? reportOnly(request, event) : enforce(request, event);
export const config = {matcher: ["/((?!api/vulnerable|api/csp-report|static|_next/static|_next/image|favicon.ico).*)"]};
