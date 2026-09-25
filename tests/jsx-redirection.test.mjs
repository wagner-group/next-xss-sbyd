import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdir, mkdtemp, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const compiled = require("next/dist/compiled/webpack/webpack");

const {webpack} = compiled;
const repair = "Maintainer: check next-config.ts import matching, issuer exclusions and replacement paths; preserve Next's React aliases. If React changed exports/signatures, update both JSX runtime wrappers and rerun test:jsx-redirection.";

async function bundle({development = false, enabled = true, symlinks = true, callback = false, externalRuntime = false} = {}) {
  const {withXssSbyd} = await import("next-xss-sbyd/next-config");
  await mkdir(path.join(root, "tmp"), {recursive: true});
  const directory = await mkdtemp(path.join(root, "tmp/jsx-bundle-"));
  await mkdir(path.join(directory, "node_modules/library"), {recursive: true});
  await writeFile(path.join(directory, "node_modules/library/package.json"), JSON.stringify({name: "library", exports: {".": "./index.mjs", "./cjs": "./index.cjs"}}));
  const runtime = development ? "jsx-dev-runtime" : "jsx-runtime";
  const factory = development ? "jsxDEV" : "jsx";
  await writeFile(path.join(directory, "node_modules/library/index.mjs"), `import * as runtime from 'react/${runtime}'; import defaultRuntime from 'react/${runtime}'; export {runtime}; export function defaultElement(type, props) {return defaultRuntime.${factory}(type, props, undefined, false);} export function element(type, props) {return runtime.${factory}(type, props, 'key', false, undefined, undefined);}`);
  await writeFile(path.join(directory, "node_modules/library/index.cjs"), `const runtime = require('react/${runtime}'); exports.element = (type, props) => runtime.${factory}(type, props, 'key', false);`);
  await writeFile(path.join(directory, "entry.mjs"), `
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement, cloneElement} from 'react';
import {element, defaultElement, runtime} from 'library';
import {element as cjs} from 'library/cjs';
import {htmlEscape, SafeBlock, SafeJsonScript} from 'next-xss-sbyd';
const enabled = ${enabled};
for (const make of [element, cjs, defaultElement]) {
 assert.equal(renderToStaticMarkup(make('p', {children:'<plain>'})), '<p>&lt;plain&gt;</p>');
 for (const [tag, props, message] of [
  ['div', {dangerouslySetInnerHTML:{__html:'<b>unchecked</b>'}}, /SafeHtml/],
  ['iframe', {srcDoc:'<b>unchecked</b>'}, /SafeHtml/],
  ['a', {href:'data:text/html,bad', children:'link'}, /URL/],
  ['iframe', {src:'/frame'}, /TrustedScriptUrl/],
 ]) {
  if (enabled) assert.throws(()=>renderToStaticMarkup(make(tag,props)), message);
  else assert.doesNotThrow(()=>renderToStaticMarkup(make(tag,props)));
 }
 if(enabled) {
  assert.match(renderToStaticMarkup(make('div', {dangerouslySetInnerHTML:{__html:htmlEscape('<safe>')}})), /&lt;safe&gt;/);
  assert.equal(renderToStaticMarkup(make('img', {src:'', alt:'removed'})), '<img alt="removed"/>');
 }
 const props={id:'unchanged',children:'text'};
 assert.equal(element('p', props).key,'key');
 assert.equal(props.id,'unchanged');
}
assert.match(renderToStaticMarkup(createElement(SafeBlock,{html:htmlEscape('<block>')})), /&lt;block&gt;/);
assert.match(renderToStaticMarkup(createElement(SafeJsonScript,{id:'state',data:{a:'<json>'}})), /\\\\u003cjson/);
// Deliberate limits: classic creation and later cloning are outside JSX redirection.
assert.match(renderToStaticMarkup(createElement('div',{dangerouslySetInnerHTML:{__html:'<b>classic</b>'}})), /<b>classic<\\/b>/);
assert.match(renderToStaticMarkup(cloneElement(element('div',{}),{dangerouslySetInnerHTML:{__html:'<b>clone</b>'}})), /<b>clone<\\/b>/);
assert.equal(typeof runtime.Fragment, 'symbol');
assert.equal(runtime.default.Fragment, runtime.Fragment);
assert.deepEqual(Object.keys(runtime).filter(name=>name !== 'default').sort(), ${JSON.stringify(Object.keys(require(`react/${runtime}`)).sort())}, 'React runtime exports changed: update next-xss-sbyd JSX wrappers before upgrading React.');
${development ? "assert.equal(typeof runtime.jsxDEV, 'function');" : "assert.equal(typeof runtime.jsxs, 'function'); assert.match(renderToStaticMarkup(runtime.jsxs(runtime.Fragment,{children:[element('i',{children:'one'}),element('b',{children:'two'})]})), /<i>one<\\/i><b>two<\\/b>/);"}
console.log('rendered and checked');
`);
  let called = false;
  function existing(config, options) {
    assert.equal(this.marker, "preserved");
    assert.equal(options.dir, directory);
    called = true;
    return {...config, name: "existing-callback"};
  }
  const wrapped = withXssSbyd(callback ? {webpack: existing} : {}, {redirectJsxRuntime: enabled});
  const config = {mode: development ? "development" : "production", target: "node", entry: path.join(directory, "entry.mjs"), output: {path: directory, filename: "out.cjs"}, resolve: {symlinks}, optimization: {minimize: false}, externals: {"node:assert/strict": "commonjs node:assert/strict"}};
  if (callback) config.cache = {type: "filesystem", cacheDirectory: path.join(directory, "cache")};
  if (externalRuntime) Object.assign(config.externals, {
    "react/jsx-runtime": `commonjs ${require.resolve("react/jsx-runtime")}`,
    "react/jsx-dev-runtime": `commonjs ${require.resolve("react/jsx-dev-runtime")}`,
  });
  const options = {dir: directory, webpack, dev: development, isServer: true, nextRuntime: "nodejs"};
  const configured = wrapped.webpack ? wrapped.webpack.call({marker:"preserved"}, config, options) : config;
  assert.equal(called, callback);
  await new Promise((resolve, reject) => {
    const compiler = webpack(configured);
    compiler.run((error, stats) => compiler.close((closeError) => {
      if(error || closeError || stats?.hasErrors()) reject(new Error(`${error || closeError || stats.toString({all:false,errors:true})}\n${repair}`));
      else resolve();
    }));
  });
  const result = spawnSync(process.execPath, [path.join(directory, "out.cjs")], {encoding:"utf8", env:{...process.env, NODE_ENV:development?'development':'production'}});
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${repair}`);
}

for (const options of [{}, {development:true}, {symlinks:false,callback:true}, {enabled:false,callback:true}, {externalRuntime:true}, {externalRuntime:true,development:true}]) {
 test(`real webpack builds and renders ESM/CJS libraries ${JSON.stringify(options)}`, () => bundle(options));
}

test("Turbopack configuration fails explicitly unless redirection is disabled", () => {
 const source = "import {withXssSbyd} from 'next-xss-sbyd/next-config'; withXssSbyd();";
 const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {cwd:root,encoding:"utf8",env:{...process.env,TURBOPACK:"1"}});
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/Turbopack.*--webpack/s, "Maintainer: unsupported bundlers must report missing redirection, not silently drop it.");
 const disabled = spawnSync(process.execPath, ["--input-type=module", "-e", source.replace('withXssSbyd();','withXssSbyd({}, {redirectJsxRuntime:false});')], {cwd:root,encoding:"utf8",env:{...process.env,TURBOPACK:"1"}});
 assert.equal(disabled.status,0,disabled.stderr);
 assert.match(disabled.stderr,/disabled/);
});

// Exercise the published API in a fresh Node process, including JavaScript callers
// that do not receive NextConfig's compile-time checks.
test("unresolved configs and invalid options fail without discarding configuration", () => {
 const source = `
import assert from 'node:assert/strict';
import {withXssSbyd} from 'next-xss-sbyd/next-config';
for (const config of [() => ({reactStrictMode:true}), async () => ({}), Promise.resolve({}), {then() {}}, null, [], 'config']) {
 for (const options of [{}, {redirectJsxRuntime:false}]) {
  assert.throws(() => withXssSbyd(config, options), {name:'TypeError', message:/resolved.*configuration object/});
 }
}
for (const options of [{redirectJsxRuntim:false}, {redirectJsxRuntime:'false'}, null, []]) {
 assert.throws(() => withXssSbyd({}, options), TypeError);
}
for (const options of [{}, {redirectJsxRuntime:undefined}, {redirectJsxRuntime:true}]) {
 const config = withXssSbyd({reactStrictMode:true, transpilePackages:['library']}, options);
 assert.equal(config.reactStrictMode, true);
 assert.deepEqual(config.transpilePackages, ['library', 'next-xss-sbyd', 'safevalues']);
}
const config = await (async () => ({reactStrictMode:true, images:{domains:['example.com']}}))();
assert.equal(withXssSbyd(config, {redirectJsxRuntime:false}), config);
assert.deepEqual(withXssSbyd(config).images, config.images);
`;
 const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {cwd:root, encoding:"utf8"});
 assert.equal(result.status, 0, result.stderr);
});
