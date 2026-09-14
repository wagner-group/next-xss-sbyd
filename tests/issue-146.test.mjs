import assert from "node:assert/strict";
import {once} from "node:events";
import {createServer} from "node:http";
import test from "node:test";
import {apiResolver} from "next/dist/server/api-utils/node/api-resolver.js";
import {htmlEscape} from "next-xss-sbyd";
import {withSafeApiRoute} from "next-xss-sbyd/enforce";
test("SafeHtml end preserves its completion callback", async () => {
  let completed = false;
  const server = createServer((req, res) => apiResolver(req, res, {}, {default: withSafeApiRoute((_request, response) => {
    response.safeEnd(htmlEscape("safe"), () => { completed = true; });
  })}, {}, true));
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(await response.text(), "safe");
  assert.equal(completed, true);
  server.close(); await once(server, "close");
});
