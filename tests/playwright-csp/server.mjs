import {createServer} from "node:http";
import {randomBytes} from "node:crypto";

/** Serve real document responses with controlled CSP policies and fresh nonces. */
export async function startServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    const mode = url.pathname.slice(1);
    if (mode === "redirect") {
      response.writeHead(302, {Location: "/strict"});
      response.end();
      return;
    }
    const nonce = mode === "download" ? url.searchParams.get("nonce") : mode === "reuse" ? "cmV1c2VkLW5vbmNl" : randomBytes(18).toString("base64");
    const strict = `script-src 'nonce-${nonce}' 'strict-dynamic'; object-src 'none'; base-uri 'self'`;
    let policy = strict;
    if (mode === "unsafe") policy += "; script-src-elem 'unsafe-inline'";
    if (mode === "attr") policy += "; script-src-attr 'unsafe-inline'";
    if (mode === "duplicate") policy += "; script-src 'unsafe-inline'";
    if (mode === "first-duplicate") policy = "script-src 'unsafe-inline'; " + strict;
    if (mode === "empty-nonce") policy = "script-src 'nonce-' 'strict-dynamic'; object-src 'none'; base-uri 'self'";
    if (mode === "two-nonces") policy = strict.replace("'strict-dynamic'", "'nonce-c2Vjb25k' 'strict-dynamic'");
    if (mode === "eval") policy = strict.replace("'strict-dynamic'", "'strict-dynamic' 'unsafe-eval'");
    if (mode === "wasm") policy = strict.replace("'strict-dynamic'", "'strict-dynamic' 'wasm-unsafe-eval'");
    if (mode === "inline") policy = strict.replace("'strict-dynamic'", "'strict-dynamic' 'unsafe-inline'");
    if (mode === "elem") policy += `; script-src-elem 'nonce-${nonce}' 'strict-dynamic'; script-src-attr 'none'`;
    if (mode === "repeated") policy = [strict, `script-src 'nonce-${nonce}'`];
    if (mode === "list") policy += `, script-src 'nonce-${nonce}'`;
    if (mode === "second-blocks") policy = [strict, "script-src 'none'"];
    if (mode === "report") response.setHeader("Content-Security-Policy-Report-Only", policy);
    else if (mode !== "missing" && mode !== "meta") response.setHeader("Content-Security-Policy", policy);
    if (mode === "download") response.setHeader("Content-Disposition", 'attachment; filename="download.html"');
    if (mode === "not-found") response.statusCode = 404;
    response.setHeader("Content-Type", mode === "download" ? "application/octet-stream" : "text/html");
    response.end(`<!doctype html><html><head>${mode === "meta" ? `<meta http-equiv="Content-Security-Policy" content="${strict}">` : ""}</head><body><h1>Ready</h1><script id="authorized" nonce="${mode === "mismatch" ? "d3Jvbmc=" : nonce}">document.documentElement.dataset.ready='yes';${mode === "self-navigation" ? "location.replace('/strict')" : ""}</script><button id="attack">Attack</button>${mode === "initial" || mode === "report" ? "<script>document.documentElement.dataset.secretScript='SCRIPT_CONTENT_SECRET'</script>" : ""}</body></html>`);
  });
  await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
  return {url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))};
}
