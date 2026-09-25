import {probes as esm} from "jsx-probe-esm";
import {probes as cjs} from "jsx-probe-cjs";
export const runtime = "edge";
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({esm: esm(), cjs: cjs()});
}
