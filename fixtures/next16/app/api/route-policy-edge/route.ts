import {withSafeRouteHandler} from "next-xss-sbyd/route-handler";

export const runtime = "edge";

/** Confirms the wrapper enforces responses without Node's constructor guard. */
export const GET = withSafeRouteHandler(function GET(request: Request) {
  if (new URL(request.url).searchParams.has("unsafe")) {
    return new Response(new Blob(["<script>unsafe()</script>"], {type: "text/html"}));
  }
  return Response.json({runtime: "edge", wrapped: true});
}, "app/api/route-policy-edge/route.ts GET");
