import type {NextApiRequest, NextApiResponse} from "next";
export default function handler(_req: NextApiRequest, res: NextApiResponse) { res.setHeader("content-type", "text/html"); res.send("<script>globalThis.__XSS_SBYD_VULNERABLE__='executed'</script>"); }
