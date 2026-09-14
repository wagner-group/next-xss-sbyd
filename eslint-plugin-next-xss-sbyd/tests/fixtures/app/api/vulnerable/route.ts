import {NextResponse} from "next/server";

declare const input: string;
const ResponseAlias = Response;

export function GET() {
  const htmlHeaders = new Headers([["content-type", "text/html"]]);
  const responseA = new Response(input);
  const responseB = new ResponseAlias(input, {headers: {"Content-Type": "text/html"}});
  const responseC = new NextResponse(input);
  const stream = new Response(new ReadableStream<Uint8Array>());
  const hiddenHtml = new Response(new Blob([input]), {headers: htmlHeaders});
  const bytes = new Response(new Uint8Array([60, 104, 49, 62]));
  const buffer = new Response(new ArrayBuffer(4));
  const blob = new Response(new Blob([input]));
  const params = new Response(new URLSearchParams({html: input}));
  return Response.json({responses: [responseA.status, responseB.status, responseC.status, stream.status, hiddenHtml.status, bytes.status, buffer.status, blob.status, params.status]});
}
