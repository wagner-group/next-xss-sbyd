export const runtime = "edge";
export function GET() { return Response.json({runtime: "edge", ok: true}); }
