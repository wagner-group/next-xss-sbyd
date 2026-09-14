import assert from "node:assert/strict";
import {once} from "node:events";
import {createServer} from "node:http";
import test from "node:test";
import {withSafeApiRoute} from "next-xss-sbyd/enforce";
test("callback-based Node handlers remain guarded until response completion", async () => {
  const server = createServer(withSafeApiRoute((_req, res) => setImmediate(() => {
    res.setHeader("content-type", "text/html");
    try { res.end("<script>unsafe</script>"); }
    catch (error) { res.statusCode = 400; res.setHeader("content-type", "text/plain"); res.end(error.message); }
  })));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /Raw string response/u);
  server.close(); await once(server, "close");
});
