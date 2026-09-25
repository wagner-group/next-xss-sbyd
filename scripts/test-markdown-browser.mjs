import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import React from 'react';
import {renderToString} from 'react-dom/server';
import {build} from 'esbuild';
import {chromium, firefox, webkit} from 'playwright-core';
import {SafeMarkdown} from 'next-xss-sbyd/markdown';
import {source, attacks} from '../tests/browser-markdown/source.mjs';

const directory = new URL('../', import.meta.url);
const output = new URL('tmp/browser-markdown/', directory);
await mkdir(output, {recursive: true});
const bundle = await build({
  bundle: true, platform: 'browser', conditions: ['browser'], format: 'iife',
  minify: true, write: false, metafile: true,
  define: {'process.env.NODE_ENV': '"production"'},
  entryPoints: [new URL('tests/browser-markdown/app.mjs', directory).pathname],
});
assert.deepEqual(Object.keys(bundle.metafile.inputs).filter(path => /(?:^|\/)(?:jsdom|dompurify)(?:\/|$)/.test(path)), [], 'Markdown browser graph must exclude DOM sanitizers');
await writeFile(new URL('app.js', output), bundle.outputFiles[0].contents);
// A core-entry import must not pull the Markdown renderer into unrelated apps.
const core = await build({bundle: true, platform: 'browser', conditions: ['browser'], write: false, metafile: true,
  stdin: {contents: "export {validateUrl} from 'next-xss-sbyd'", resolveDir: directory.pathname},
});
assert.deepEqual(Object.keys(core.metafile.inputs).filter(path => /(?:^|\/)(?:react-markdown|rehype-sanitize)(?:\/|$)/.test(path)), []);
const markup = renderToString(React.createElement(SafeMarkdown, {children: source}));
const requests = [];
let origin;
const server = createServer(async function serve(request, response) {
  const url = new URL(request.url, origin);
  requests.push({path: url.pathname, referer: request.headers.referer});
  if (url.pathname === '/') {
    if (url.searchParams.has('csp')) response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'nonce-markdown-test'; img-src 'self'; base-uri 'none'; object-src 'none'");
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><meta charset="utf-8"><title>Markdown</title><div id="root">${markup}</div><script nonce="markdown-test" src="/app.js"></script>`);
  } else if (url.pathname === '/app.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(bundle.outputFiles[0].contents);
  } else if (url.pathname === '/pixel.png') {
    response.setHeader('Content-Type', 'image/png');
    response.end(await readFile(new URL('tests/browser-sanitize/assets/pixel.png', directory)));
  } else if (url.pathname === '/destination') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<h1>Destination</h1>');
  } else response.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${server.address().port}`;

/** Assert the live DOM has no executable elements or content-controlled attributes. */
async function assertInert(page) {
  assert.equal(await page.locator('#root script, #root iframe, #root svg, #root math, #root form, #root [id], #root [name], #root [style], #root [class], #root [target], #root [srcset]').count(), 0);
  assert.equal(await page.locator('#root *').evaluateAll(elements => elements.some(element => [...element.attributes].some(attr => /^on/i.test(attr.name)))), false);
  assert.equal(await page.evaluate(() => globalThis.__markdownAttack), undefined);
}

/** Exercise production SSR hydration, subsequent updates, real navigation, and fail-closed errors. */
async function verify(browser, suffix) {
  const page = await browser.newPage();
  const errors = [];
  const network = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => network.push(request.url()));
  try {
    await page.goto(`${origin}/${suffix}`);
    await page.waitForFunction(() => window.markdownHarness?.ready());
    assert.deepEqual(await page.evaluate(() => window.markdownHarness.errors()), []);
    assert.equal(await page.locator('h1').textContent(), 'Safe Markdown');
    assert.equal(await page.locator('strong').textContent(), 'formatting');
    assert.equal(await page.locator('#root a').getAttribute('rel'), 'nofollow noopener noreferrer');
    assert.equal(await page.locator('#root img').getAttribute('referrerpolicy'), 'no-referrer');
    await page.locator('#root img').evaluate(image => image.decode());
    assert.match(await page.locator('#root').textContent(), /fallback/);
    assert.match(await page.locator('#root').textContent(), /\{globalThis.__markdownAttack=1\}/);
    await assertInert(page);
    await page.evaluate(() => window.markdownHarness.update({children: '[blocked](javascript:globalThis.__markdownAttack=1)'}));
    await page.getByText('blocked', {exact: true}).click();
    assert.equal(page.url(), `${origin}/${suffix}`);
    for (const children of attacks) {
      await page.evaluate(children => window.markdownHarness.update({children}), children);
      await assertInert(page);
      assert.equal(await page.locator('#root a, #root img').count(), 0, children);
    }
    assert.deepEqual(errors, [], 'safe rendering must not throw browser errors');
    const invalid = [
      {children: 'source', components: {}}, {children: 'source', rehypePlugins: []},
      {children: 'source', urlTransform: 'unsafe'}, {children: 'source', skipHtml: false},
      {children: 'source', dangerouslySetInnerHTML: {__html: '<img src=/attack>'}},
      {children: null}, {children: 'a'.repeat(32769)}, {children: '😀'.repeat(8193)},
      {children: '> '.repeat(129) + 'deep'}, {children: '['.repeat(1025)},
      {children: '*`a`*'.repeat(300)},
    ];
    for (const props of invalid) {
      await page.evaluate(props => window.markdownHarness.update(props), props);
      assert.match(await page.locator('#failure').textContent(), /SafeMarkdown/);
      assert.equal(await page.locator('#root a, #root img, #root script').count(), 0);
    }
    await page.evaluate(() => window.markdownHarness.update({children: '## Updated\n\n[go](/destination)'}));
    assert.equal(await page.locator('h2').textContent(), 'Updated');
    assert.deepEqual(await page.evaluate(() => window.markdownHarness.errors()), []);
    assert.ok(network.every(url => url.startsWith(origin)), `Unexpected external request: ${network}`);
    assert.equal(network.some(url => url.includes('/attack')), false);
    await Promise.all([page.waitForURL(`${origin}/destination`), page.getByRole('link', {name: 'go'}).click()]);
  } finally { await page.close(); }
}

try {
  for (const name of (process.env.MARKDOWN_BROWSERS ?? 'chromium,firefox,webkit').split(',')) {
    const browser = await ({chromium, firefox, webkit}[name]).launch({headless: true});
    try {
      await verify(browser, '');
      await verify(browser, '?csp');
      console.log(`${name} ${browser.version()}: Markdown SSR/hydration/updates, attacks, limits, requests and navigation passed with and without CSP`);
    } finally { await browser.close(); }
  }
  const pixels = requests.filter(request => request.path === '/pixel.png');
  assert.ok(pixels.length > 0);
  assert.ok(pixels.every(request => request.referer === undefined), 'Images must not send a referrer');
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
