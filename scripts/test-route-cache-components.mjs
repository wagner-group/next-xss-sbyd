import assert from "node:assert/strict";
import {createServer} from "node:net";
import {once} from "node:events";
import {spawn} from "node:child_process";
import {mkdir, mkdtemp, symlink, writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";

// This separate app enables cacheComponents without changing the existing dynamic
// compatibility routes, whose force-dynamic settings are incompatible with it.
const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(path.join(root, "tmp"), {recursive: true});
const directory = await mkdtemp(path.join(root, "tmp", "route-cache-components-"));
await symlink(path.join(root, "fixtures/next16/node_modules"), path.join(directory, "node_modules"));
await mkdir(path.join(directory, "app/api/static"), {recursive: true});
await writeFile(path.join(directory, "package.json"), JSON.stringify({name: "route-cache-components", private: true, type: "module"}));
await writeFile(path.join(directory, "next.config.mjs"), `export default {cacheComponents: true, turbopack: {root: ${JSON.stringify(root)}}, outputFileTracingRoot: ${JSON.stringify(root)}};\n`);
await writeFile(path.join(directory, "app/layout.tsx"), 'export default function Layout({children}: {children: React.ReactNode}) { return <html><body>{children}</body></html>; }\n');
await writeFile(path.join(directory, "app/page.tsx"), 'export default function Page() { return <main>cache-components</main>; }\n');
await writeFile(path.join(directory, "app/api/static/route.ts"), `
import {SafeResponse, htmlEscape} from "next-xss-sbyd";
import {withSafeRouteHandler} from "next-xss-sbyd/enforce";
export const GET = withSafeRouteHandler(function GET() {
  return new SafeResponse(htmlEscape("<cache-components-safe>"));
}, "app/api/static/route.ts GET");
`);
const next = path.join(root, "fixtures/next16/node_modules/next/dist/bin/next");
const environment = {...process.env, NODE_OPTIONS: "", NEXT_TELEMETRY_DISABLED: "1"};

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [next, ...args], {cwd: directory, env: environment, stdio: "inherit"});
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Next ${args[0]} exited ${code}`)));
  });
}

await run(["build"]);
const allocation = createServer().listen(0, "127.0.0.1");
await once(allocation, "listening");
const port = String(allocation.address().port);
await new Promise((resolve) => allocation.close(resolve));
const server = spawn(process.execPath, [next, "start", "-p", port], {cwd: directory, env: environment, stdio: "inherit"});
const closed = new Promise((resolve) => server.once("close", resolve));
try {
  let response;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw new Error(`Next server exited ${server.exitCode}`);
    try { response = await fetch(`http://127.0.0.1:${port}/api/static`); break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  assert(response, "cacheComponents fixture did not start");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await response.text(), "&lt;cache-components-safe&gt;");
  assert.equal(response.headers.get("x-nextjs-cache"), "HIT", "static route was not served from Next prerender cache");
  console.log("Next16 cacheComponents static authenticated HTML passed from prerender cache.");
} finally {
  server.kill("SIGTERM");
  const timer = setTimeout(() => server.kill("SIGKILL"), 5000);
  await closed;
  clearTimeout(timer);
}
