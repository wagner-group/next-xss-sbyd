import {NextResponse} from "next/server";
import {htmlEscape, SafeNextResponse} from "next-xss-sbyd";
import {isGuardInstalled} from "next-xss-sbyd/enforce";

export function GET(request: Request) {
  if (!isGuardInstalled()) return new Response("guard-missing", {status: 500});
  if (new URL(request.url).searchParams.get("mode") === "unsafe") {
    return new NextResponse("<unsafe>", {headers: {"Content-Type": "text/html"}});
  }
  return new SafeNextResponse(htmlEscape("<safe>"));
}
