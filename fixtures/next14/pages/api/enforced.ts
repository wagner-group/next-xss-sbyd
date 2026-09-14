import type {NextApiRequest} from "next";
import {htmlEscape, type SafeApiResponse} from "next-xss-sbyd";
import {withSafeApiRoute} from "next-xss-sbyd/enforce";

export default withSafeApiRoute(function handler(request: NextApiRequest, response: SafeApiResponse) {
  if (request.query.mode === "safe") return response.safeSend(htmlEscape("<safe>"));
  if (request.query.mode === "json") return response.json({ok: true});
  if (request.query.mode === "buffer") return response.send(Buffer.from("bytes"));
  if (request.query.mode === "empty") return response.status(204).end();
  response.setHeader("Content-Type", request.query.mode === "plain" ? "text/plain" : "text/html");
  return response.send("raw");
});
