export function GET() { return new Response("<script>globalThis.__XSS_SBYD_VULNERABLE__='executed'</script>", {headers: {"content-type": "text/html"}}); }
