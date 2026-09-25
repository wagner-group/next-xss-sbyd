import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {createWriteStream} from "node:fs";
import {cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile} from "node:fs/promises";
import {resolve, join} from "node:path";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright-core";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = process.argv[2] ?? "next16";
assert(["next14", "next15", "next16"].includes(fixture), "Use next14, next15 or next16");
const fixtureRoot = resolve(process.env.JSX_TEST_FIXTURES ?? join(root, "fixtures"));
const fixtureModules = join(fixtureRoot, fixture, "node_modules");
const major = Number(fixture.slice(4));
const repair = "Inspect packages/next-xss-sbyd/src/next-config.ts: Next may have changed webpack's issuer paths, externalization, aliases, condition names, or JSX runtime imports. Update the resolver/exclusions without redirecting Next internals or the checking runtime back to itself.";
await mkdir(join(root, "tmp"), {recursive: true});
const directory = await mkdtemp(join(root, "tmp", `jsx-next-${fixture}-`));
const modules = join(directory, "node_modules");
await mkdir(modules);

// Reuse installed dependencies but copy the package under test: workspace symlinks
// can otherwise silently test a different checkout or a second React installation.
for (const source of [fixtureModules, join(root, "node_modules")]) {
  for (const name of await readdir(source)) {
    if (name === "next-xss-sbyd" || name === ".bin") continue;
    try { await symlink(join(source, name), join(modules, name), "dir"); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  }
}
await cp(join(root, "packages/next-xss-sbyd/dist"), join(modules, "next-xss-sbyd/dist"), {recursive: true});
await cp(join(root, "packages/next-xss-sbyd/package.json"), join(modules, "next-xss-sbyd/package.json"));
await cp(join(root, "tests/jsx-redirection-fixture/app"), join(directory, "app"), {recursive: true});
// Next 16.3.2 cannot collect Edge route data (missing client-reference manifest).
// The existing compatibility matrix also excludes its deprecated Edge runtime.
if (major >= 16) await rm(join(directory, "app/edge"), {recursive: true});
await cp(join(root, "tests/jsx-redirection-fixture/pages"), join(directory, "pages"), {recursive: true});
await writeFile(join(directory, "package.json"), JSON.stringify({name: "jsx-redirection-next-test", private: true, type: "module"}));
const probes = await readFile(join(root, "tests/jsx-redirection-fixture/probes.js"), "utf8");
for (const kind of ["esm", "cjs", "lazy", "external"]) {
  const name = `jsx-probe-${kind}`;
  await mkdir(join(modules, name));
  // Omit type for conventional CJS: Next 14 Pages refresh injects import.meta,
  // which webpack rejects if the package explicitly declares type:commonjs.
  await writeFile(join(modules, name, "package.json"), JSON.stringify({name, version: "1.0.0", type: kind === "cjs" || kind === "external" ? undefined : "module", main: "index.js"}));
  let source = probes;
  if (kind === "cjs") source = source.replaceAll(/import \{([^}]+)\} from "([^"]+)";/g, 'const {$1} = require("$2");').replaceAll(/export function (\w+)\(/g, "exports.$1 = function $1(");
  if (kind === "external") source = 'const {jsx} = require("react/jsx-runtime"); module.exports = function external() {return jsx("div", {dangerouslySetInnerHTML: {__html: "external-raw"}}).props.dangerouslySetInnerHTML.__html;};';
  await writeFile(join(modules, name, "index.js"), source);
}

/** Launch a real Next process and retain complete diagnostics for upgrade failures. */
function next(args, label, enabled) {
  const log = createWriteStream(join(directory, `${label}.log`));
  const child = spawn(process.execPath, [join(fixtureModules, "next/dist/bin/next"), ...args], {
    cwd: directory, detached: process.platform !== "win32",
    env: {...process.env, NODE_OPTIONS: "", NEXT_TELEMETRY_DISABLED: "1", JSX_REDIRECT: enabled ? "1" : "0"},
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log, {end: false});
  child.stderr.pipe(log, {end: false});
  child.once("close", () => log.end());
  return child;
}

/** Stop the entire process tree, including Next's development worker. */
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  function signal(value) {
    try { if (process.platform === "win32") child.kill(value); else process.kill(-child.pid, value); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  }
  const timeout = setTimeout(() => signal("SIGKILL"), 5000);
  signal("SIGTERM");
  await exited;
  clearTimeout(timeout);
}

/** Wait for compilation and reject HTTP errors with pointers to the build logs. */
async function ready(origin, child, label) {
  for (let i = 0; i < 180; i++) {
    assert.equal(child.exitCode, null, `${label}: Next exited. See ${directory}. ${repair}`);
    try {
      const response = await fetch(origin, {signal: AbortSignal.timeout(3000)});
      if (response.status === 200) return;
      if (response.status >= 500) throw new Error(`${label}: HTTP ${response.status}. See ${directory}. ${repair}`);
    } catch (error) {
      if (error.message.includes("HTTP ")) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`${label}: startup timed out. See ${directory}. ${repair}`);
}

/** Assert actual rejection behavior, including diagnostic quality, for each compiler/runtime path. */
function verifyProbes(result, enabled, development, label) {
  for (const factory of development ? ["jsx", "jsxs", "jsxDEV"] : ["jsx", "jsxs"]) {
    for (const sink of ["html", "srcDoc", "url"]) {
      const observed = result[`${factory}:${sink}`];
      if (enabled) {
        assert.match(observed, /^TypeError:/, `${label}: ${factory} accepted ${sink}: ${observed}. ${repair}`);
        assert.match(observed, sink === "url" ? /URL|url|href/ : /SafeHtml/, `${label}: rejection lost its remediation message; check jsx-guard.ts and url-sinks.ts.`);
      } else assert.equal(observed, "accepted", `${label}: opt-out still redirects ${factory}/${sink}. ${repair}`);
    }
    assert.equal(result[`${factory}:fragment`], "key", `${label}: React JSX Fragment/key contract changed; update jsx-runtime.ts and jsx-dev-runtime.ts argument forwarding.`);
  }
  assert.equal(result.classic, "raw", `${label}: createElement coverage changed; review and update the documented scope.`);
  assert.equal(result.clone, "raw", `${label}: cloneElement coverage changed; review and update the documented scope.`);
}

/** Detect compiler changes even when manually imported runtime factories still work. */
async function verifyCompiled(page, id, enabled, label) {
  const observed = await page.locator(`#${id}`).textContent();
  const message = `${label}/${id}: Next JSX transform changed runtime imports/factory; update next-config.ts or wrappers. Observed ${observed}`;
  if (enabled) assert.match(observed, /^TypeError:.*SafeHtml/, message);
  else assert.equal(observed, "accepted", message);
}

const externalConfig = major === 14 ? 'experimental: {cpus: 2, serverComponentsExternalPackages: ["jsx-probe-external"]}' : 'experimental: {cpus: 2}, serverExternalPackages: ["jsx-probe-external"]';
await writeFile(join(directory, "next.config.mjs"), `import {withXssSbyd} from "next-xss-sbyd/next-config";
export default withXssSbyd({${externalConfig}, transpilePackages: ["jsx-probe-esm", "jsx-probe-cjs", "jsx-probe-lazy"], webpack(config) {config.resolve.alias["fixture-user-alias"] = false; return config;}}, process.env.JSX_REDIRECT === "0" ? {redirectJsxRuntime: false} : undefined);\n`);
// A CLI-level assertion detects future Next changes to the TURBOPACK signal.
const turbo = next(["dev", "--turbo", "-p", "0"], "turbopack-rejection", true);
let turboTimedOut = false;
const turboTimeout = setTimeout(() => {turboTimedOut = true; void stop(turbo);}, 20000);
try {
  const [code] = await once(turbo, "exit");
  assert(!turboTimedOut, "Next started Turbopack without rejecting unchecked imports. Update next-config.ts to detect Next's current bundler-selection signal.");
  // Next 14 exits its dev supervisor with zero even when its worker fails config loading.
  if (major >= 15) assert.notEqual(code, 0, "Turbopack must fail explicitly until issuer-aware redirection is supported.");
  const log = await readFile(join(directory, "turbopack-rejection.log"), "utf8");
  assert.match(log, /next-xss-sbyd: JSX import redirection does not support Turbopack/, "Turbopack failed without our actionable diagnosis; inspect next-config.ts and the Next CLI's environment contract.");
  assert.match(log, /redirectJsxRuntime: false/, "The unsupported-bundler error must explain the explicit compatibility opt-out.");
} finally { clearTimeout(turboTimeout); await stop(turbo); }
const browser = await chromium.launch({headless: true, executablePath: process.env.CHROME_PATH || undefined});
try {
  // Reuse the cache deliberately: environment-based config toggles must invalidate
  // redirected modules in BOTH directions, including re-enabling protection.
  const phases = [["production", true], ["development", true], ["development", false], ["development", true]];
  for (const [index, [mode, enabled]] of phases.entries()) {
    const label = `${fixture}-${mode}-${enabled ? "on" : "off"}-${index + 1}`;
    const flags = major >= 16 ? ["--webpack"] : [];
    if (mode === "production") {
      const build = next(["build", ...flags], `${label}-build`, enabled);
      try {
        const [code] = await once(build, "exit");
        assert.equal(code, 0, `${label}: build failed. See ${directory}. ${repair}`);
      } finally { await stop(build); }
    }
    // Port zero lets the OS select an available port; the server's output names it.
    const server = next([mode === "production" ? "start" : "dev", ...(mode === "production" ? [] : flags), "-p", "0", "-H", "127.0.0.1"], label, enabled);
    let output = "";
    server.stdout.on("data", chunk => {output += chunk.toString();});
    try {
      let address;
      for (let i = 0; i < 200 && !address; i++) {
        address = output.match(/http:\/\/127\.0\.0\.1:(\d+)/)?.[0];
        if (!address) await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert(address, `${label}: Next no longer reports its listening address. Read ${directory}/${label}.log and update the runner.`);
      await ready(address, server, label);
      if (major < 16) {
        const edge = await fetch(`${address}/edge`);
        assert.equal(edge.status, 200, `${label}: Edge compilation failed. ${repair}`);
        for (const [format, result] of Object.entries(await edge.json())) verifyProbes(result, enabled, mode === "development", `${label}/Edge/${format}`);
      }
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => { if (message.type() === "error" && /hydration|hydrating|did not match/i.test(message.text())) errors.push(message.text()); });
      try {
        // Inspect SSR before running scripts: hydration must not repair a server failure.
        const ssr = await browser.newPage({javaScriptEnabled: false});
        try {
          const legacyResponse = await ssr.goto(`${address}/legacy`);
          assert.equal(legacyResponse.status(), 200, `${label}: Pages SSR failed. Next may be externalizing the checking runtime as an asynchronous ESM module, which breaks synchronous CommonJS consumers. Inspect next-config.ts and ${directory}/${label}.log.`);
          for (const id of ["legacy-esm", "legacy-cjs"]) verifyProbes(JSON.parse(await ssr.locator(`#${id}`).textContent()), enabled, mode === "development", `${label}/PagesSSR/${id}`);
          await verifyCompiled(ssr, "legacy-compiled", enabled, `${label}/PagesSSR`);
          if (enabled) {
            assert.equal(await ssr.locator("#legacy-safe-esm").textContent(), "<b>safe esm</b>", "Pages ESM SafeHtml provenance failed; bundle a single safevalues instance with the checked runtime.");
            assert.equal(await ssr.locator("#legacy-safe-cjs").textContent(), "<b>safe cjs</b>", "Pages CJS SafeHtml provenance failed; keep safevalues synchronous in the bundled runtime dependency graph.");
          }
          assert.equal(await ssr.locator("#legacy-safe-block").textContent(), "<b>safe block</b>");
          await ssr.goto(address);
          for (const id of ["server-esm", "server-cjs", "client-esm", "client-cjs"]) verifyProbes(JSON.parse(await ssr.locator(`#${id}`).textContent()), enabled, mode === "development", `${label}/SSR/${id}`);
          for (const id of ["server-compiled", "client-compiled"]) await verifyCompiled(ssr, id, enabled, `${label}/SSR`);
          assert.equal(await ssr.locator("#external").textContent(), "external-raw", "Server externals should remain outside this webpack mitigation; re-evaluate its scope if this changes.");
        } finally { await ssr.close(); }
        await page.goto(`${address}/legacy`);
        await page.locator("#legacy-ready").filter({hasText: "ready"}).waitFor();
        for (const id of ["legacy-esm", "legacy-cjs"]) verifyProbes(JSON.parse(await page.locator(`#${id}`).textContent()), enabled, mode === "development", `${label}/PagesBrowser/${id}`);
        await verifyCompiled(page, "legacy-compiled", enabled, `${label}/PagesBrowser`);
        if (enabled) {
          assert.equal(await page.locator("#legacy-safe-esm").textContent(), "<b>safe esm</b>");
          assert.equal(await page.locator("#legacy-safe-cjs").textContent(), "<b>safe cjs</b>");
        }
        assert.equal(await page.locator("#legacy-safe-block").textContent(), "<b>safe block</b>");
        await page.goto(address);
        await page.locator("#ready").filter({hasText: "ready"}).waitFor();
        for (const id of ["client-esm", "client-cjs"]) verifyProbes(JSON.parse(await page.locator(`#${id}`).textContent()), enabled, mode === "development", `${label}/browser/${id}`);
        await verifyCompiled(page, "client-compiled", enabled, `${label}/browser`);
        await page.locator("#update").click();
        await page.locator("#update").filter({hasText: "Count 1"}).waitFor();
        await verifyCompiled(page, "client-compiled", enabled, `${label}/update`);
        await page.locator("#load").click();
        await page.locator("#lazy").filter({hasText: "jsx:html"}).waitFor();
        verifyProbes(JSON.parse(await page.locator("#lazy").textContent()), enabled, mode === "development", `${label}/lazy`);
        assert.equal(await page.locator("#safe-block").textContent(), "<b>escaped</b>", "SafeBlock was intercepted twice; preserve the package issuer exclusion.");
        if (enabled) assert.equal(await page.locator("#safe-direct").textContent(), "<b>direct</b>", "SafeHtml stopped unwrapping; inspect jsx-guard.ts and safevalues instance resolution.");
        assert.equal(await page.locator("#markdown h1").textContent(), "Heading");
        assert.equal(await page.locator("#markdown script").count(), 0);
        assert.equal(await page.locator("#markdown a").getAttribute("href"), "/?navigation=yes", "SafeMarkdown's generated props no longer match the checking runtime. Update markdown.tsx adapters; do not disable URL validation.");
        assert.equal(await page.locator('#react-markdown img[alt="safe"]').getAttribute("src"), "/favicon.ico", "react-markdown safe images stopped rendering; inspect URL validation.");
        const rejectedSrc = await page.locator('#react-markdown img[alt="rejected"]').getAttribute("src");
        if (enabled) assert.equal(rejectedSrc, null, "react-markdown represents rejected image URLs as empty strings. Keep the img src omission in url-sinks.ts, or adapt to the library's new contract without accepting unsafe URLs.");
        else assert([null, ""].includes(rejectedSrc), "react-markdown no longer removes unsafe image URLs; re-check the compatibility fixture.");
        await page.locator("#next-link").click();
        await page.waitForURL(`${address}/?navigation=yes`);
        assert.deepEqual(errors, [], `${label}: Next internals, React refs/hooks or hydration broke. ${repair}`);
      } finally { await page.close(); }
      console.log(`${label}: RSC, ${major < 16 ? "Edge, " : ""}Pages, SSR, hydration, updates, refs, lazy imports, ESM/CJS, SafeHtml, SafeBlock, Markdown, navigation and documented bypasses passed`);
    } finally { await stop(server); }
  }
} finally { await browser.close(); }
console.log(`Next JSX redirection logs: ${directory}`);
