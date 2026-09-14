import {htmlEscape, SafeResponse} from "next-xss-sbyd";
import {withSafeRouteHandler} from "next-xss-sbyd/route-handler";

export const dynamic = "force-static";

/** Authenticates HTML before Next prerenders and buffers its body. */
export const GET = withSafeRouteHandler(function GET() {
  return new SafeResponse(htmlEscape("<static-safe>"));
});
