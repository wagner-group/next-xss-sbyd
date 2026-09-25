import {cp, mkdir, rm} from "node:fs/promises";
import {pathToFileURL} from "node:url";

const scratch = new URL("../tmp/duplicate-safevalues/", import.meta.url);
await rm(scratch, {recursive: true, force: true});
await mkdir(scratch, {recursive: true});

const source = new URL("../node_modules/safevalues/", import.meta.url);
const copyA = new URL("copy-a/", scratch);
const copyB = new URL("copy-b/", scratch);
await cp(source, copyA, {recursive: true});
await cp(source, copyB, {recursive: true});

const safeA = await import(pathToFileURL(new URL("dist/mjs/index.js", copyA).pathname));
const safeB = await import(pathToFileURL(new URL("dist/mjs/index.js", copyB).pathname));
const reviewedA = await import(pathToFileURL(new URL("dist/mjs/restricted/reviewed.js", copyA).pathname));
const reviewedB = await import(pathToFileURL(new URL("dist/mjs/restricted/reviewed.js", copyB).pathname));
const {SafeBlock, SafeResponse} = await import("next-xss-sbyd");

function make(reviewed) {
  const options = {justification: "Milestone 0 duplicate-package interoperability probe"};
  return {
    html: reviewed.htmlSafeByReview("<b>safe</b>", options),
    script: reviewed.scriptSafeByReview("console.log('safe')", options),
    styleSheet: reviewed.styleSheetSafeByReview("body{color:black}", options),
    resourceUrl: reviewed.resourceUrlSafeByReview("https://example.test/app.js", options),
  };
}

function unwrapAll(api, values) {
  return {
    html: String(api.unwrapHtml(values.html)),
    script: String(api.unwrapScript(values.script)),
    styleSheet: api.unwrapStyleSheet(values.styleSheet),
    resourceUrl: String(api.unwrapResourceUrl(values.resourceUrl)),
  };
}

const expected = unwrapAll(safeA, make(reviewedA));
if (JSON.stringify(expected) !== JSON.stringify(unwrapAll(safeB, make(reviewedB)))) {
  throw new Error("Each SafeValues copy failed its own unwrappers");
}

const crossCopyAttempts = [
  () => unwrapAll(safeA, make(reviewedB)),
  () => unwrapAll(safeB, make(reviewedA)),
];
let rejected = 0;
for (const attempt of crossCopyAttempts) {
  try {
    attempt();
  } catch (error) {
    rejected += 1;
    if (!(error instanceof Error) || !/safe|type|instance/i.test(error.message)) {
      throw new Error(`Cross-copy rejection was not actionable: ${String(error)}`);
    }
  }
}
if (rejected !== crossCopyAttempts.length) {
  throw new Error("A duplicate SafeValues value crossed a package boundary unexpectedly");
}
console.log("Outcome B: compatible physical copies reject cross-copy values before emission.");

const foreignHtml = make(reviewedB).html;
assertRejectsActionably(() => new SafeResponse(foreignHtml));
assertRejectsActionably(() => SafeBlock({html: foreignHtml}));
console.log("Milestone 1 regression: SafeResponse rejects foreign SafeHtml with dedupe guidance.");

function assertRejectsActionably(attempt) {
  try {
    attempt();
  } catch (error) {
    if (error instanceof TypeError && /duplicate physical copy.*deduplicate safevalues/is.test(error.message)) return;
    throw new Error(`Runtime sink rejection was not actionable: ${String(error)}`);
  }
  throw new Error("Runtime sink emitted a SafeHtml value from a duplicate SafeValues copy");
}

// Exercise the same physical-copy rejection through an actual Node response.
const {createServer} = await import("node:http");
const {once} = await import("node:events");
const {withSafeApiRoute} = await import("next-xss-sbyd/enforce");
let sinkFailure;
const server = createServer(withSafeApiRoute(function duplicateHandler(_req, response) {
  try {
    for (const method of ["safeSend", "safeEnd"]) {
      assertRejectsActionably(() => response[method](foreignHtml));
      if (response.headersSent) throw new Error("Duplicate SafeHtml emitted headers before rejection");
    }
    response.setHeader("content-type", "text/plain");
    response.end("rejected");
  } catch (error) {
    sinkFailure = error;
    response.statusCode = 500;
    response.end();
  }
}));
server.listen(0, "127.0.0.1");
await once(server, "listening");
try {
  const response = await fetch(`http://127.0.0.1:${server.address().port}`, {signal: AbortSignal.timeout(10_000)});
  const body = await response.text();
  if (sinkFailure) throw sinkFailure;
  if (body !== "rejected") throw new Error("Duplicate SafeHtml response was not rejected");
} finally {
  server.closeAllConnections();
  const closed = once(server, "close");
  server.close();
  await closed;
}
console.log("Pages safeSend and safeEnd reject foreign SafeHtml with dedupe guidance before emission.");
