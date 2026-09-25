import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import React from 'react';
import {renderToString} from 'react-dom/server';
import {build} from 'esbuild';
import {chromium, firefox, webkit} from 'playwright-core';
import {SanitizedHtmlFrame} from 'next-xss-sbyd/sanitized-html-frame';
import {initialProps} from '../tests/browser-frame/initial.mjs';

const directory = new URL('../', import.meta.url);
const output = new URL('tmp/browser-frame/', directory);
await mkdir(output, {recursive: true});
const bundle = await build({
  bundle: true, platform: 'browser', conditions: ['browser'], format: 'iife',
  ...(process.env.FRAME_REACT_ROOT ? {alias: {react: `${process.env.FRAME_REACT_ROOT}/react`, 'react-dom': `${process.env.FRAME_REACT_ROOT}/react-dom`}} : {}),
  minify: true, write: false, metafile: true, sourcemap: 'external',
  outfile: new URL('app.js', output).pathname,
  define: {'process.env.NODE_ENV': '"production"', 'process.env': '{}'},
  entryPoints: [new URL('tests/browser-frame/app.mjs', directory).pathname],
});
assert.deepEqual(Object.keys(bundle.metafile.inputs).filter(path => /(?:^|\/)(?:jsdom|isomorphic-dompurify)(?:\/|$)/.test(path)), [], 'Browser graph must exclude Node DOM engines');
for (const file of bundle.outputFiles) await writeFile(file.path, file.contents);
const markup = renderToString(React.createElement(SanitizedHtmlFrame, initialProps));
const received = [];
const requestDetails = [];
const coverage = [];
let origin;
const server = createServer(async function serve(request, response) {
  const url = new URL(request.url, origin);
  received.push(url.pathname);
  requestDetails.push({path: url.pathname, referer: request.headers.referer});
  if (url.pathname === '/nested/page') {
    const blocked = url.searchParams.has('blocked');
    const tt = url.searchParams.get('tt');
    const trustedTypes = tt ? `; require-trusted-types-for 'script'; trusted-types ${tt === 'denied' ? "'none'" : tt === 'sink-denied' ? 'dompurify' : 'dompurify google#safe'}` : '';
    // Opaque sandbox origins do not reliably match 'self': explicit host sources
    // permit resources while preserving the frame's unique origin.
    response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-frame-test'; frame-src 'self'; img-src ${blocked ? "'none'" : origin}; media-src ${blocked ? "'none'" : origin}; base-uri 'none'; object-src 'none'${trustedTypes}`);
    if (url.searchParams.has('no-referrer')) response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><meta charset="utf-8"><title>Frame regression</title><p id="description">Description</p><p id="label">Article</p><div id="root">${markup}</div><script nonce="frame-test" src="/app.js"></script>`);
  } else if (url.pathname === '/app.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(bundle.outputFiles.find(file => file.path.endsWith('.js')).contents);
  } else if (/^\/assets\/(pixel\.png|tone\.wav|clip\.webm)$/.test(url.pathname)) {
    response.setHeader('Content-Type', {'png': 'image/png', 'wav': 'audio/wav', 'webm': 'video/webm'}[url.pathname.split('.').at(-1)]);
    response.end(await readFile(new URL(`tests/browser-sanitize${url.pathname}`, directory)));
  } else response.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${server.address().port}`;

/** Get the committed srcdoc document, including after updates. */
async function documentFrame(page, text) {
  await page.frameLocator('iframe').locator('body').filter({hasText: text}).waitFor();
  const frame = await page.locator('iframe').elementHandle();
  return frame.contentFrame();
}

/** Exercise actual browser media loading under the inherited CSP. */
async function loadMedia(frame, tag = 'audio') {
  await frame.locator(tag).evaluate(audio => audio.load());
  // Script timers and event handlers are disabled in the sandbox document,
  // including handlers registered through privileged browser evaluation.
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const result = await frame.locator(tag).evaluate(audio => audio.error ? 'blocked' : audio.readyState >= 3 ? 'loaded' : null);
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return 'timeout';
}

/** Hydration, sanitization, native sandbox isolation, refs, and updates. */
async function verify(browser, name, suffix = '') {
  const page = await browser.newPage();
  if (name === 'chromium') await page.coverage.startJSCoverage({resetOnNavigation: false});
  try {
    await page.goto(`${origin}/nested/page${suffix}`);
    await page.waitForFunction(() => window.frameHarness?.ready());
    let frame = await documentFrame(page, 'Readable content');
    assert.deepEqual(await page.evaluate(() => window.frameHarness.status().hydrationErrors), []);
    assert.equal(await page.locator('iframe').getAttribute('sandbox'), '');
    assert.equal(await page.locator('iframe').getAttribute('referrerpolicy'), 'no-referrer');
    for (const [key, value] of Object.entries(initialProps).filter(([key]) => key !== 'value')) {
      assert.equal(await page.locator('iframe').getAttribute(key === 'className' ? 'class' : key.toLowerCase()), String(value));
    }
    assert.equal(await page.locator('iframe').getAttribute('src'), null);
    assert.equal(await frame.locator('strong').textContent(), 'Safe formatting');
    await frame.locator('img').first().evaluate(image => image.decode());
    assert.equal(await frame.locator('img').first().evaluate(image => image.naturalWidth), 16);
    assert.equal(await frame.locator('img').nth(1).getAttribute('src'), null);
    assert.equal(await frame.locator('img').first().evaluate(image => image.src), `${origin}/assets/pixel.png`);
    assert.equal(await loadMedia(frame), 'loaded');
    if (await frame.locator('video').evaluate(video => video.canPlayType('video/webm; codecs="vp8"'))) assert.equal(await loadMedia(frame, 'video'), 'loaded');
    await page.evaluate(() => { document.cookie = 'frameHostSecret=parent-only; path=/'; });
    assert.deepEqual(await frame.evaluate(() => {
      const denied = {};
      for (const [name, operation] of Object.entries({parent() { return parent.document; }, storage() { return localStorage.length; }, cookie() { return document.cookie; }})) {
        try { const value = operation(); denied[name] = name === 'cookie' && value === ''; } catch (error) { denied[name] = error.name === 'SecurityError'; }
      }
      return denied;
    }), {parent: true, storage: true, cookie: true});
    assert.equal(await page.locator('iframe').evaluate(element => element.contentDocument), null);
    assert.equal(await frame.evaluate(() => {
      try { top.location.href = '/escaped'; return false; } catch (error) { return error.name === 'SecurityError'; }
    }), true);
    assert.equal(page.url(), `${origin}/nested/page${suffix}`);
    assert.equal(await frame.locator('a').getAttribute('target'), null);

    const isolatedStart = received.length;
    await frame.evaluate(() => {
      const form = document.createElement('form');
      form.action = '/form-escaped';
      form.method = 'GET';
      document.body.append(form);
      form.requestSubmit();
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(received.slice(isolatedStart).includes('/form-escaped'), false);
    assert.equal(frame.url(), 'about:srcdoc');
    assert.equal(await frame.evaluate(() => {
      try { return window.open('/popup-escaped') === null; }
      catch (error) { return ['InvalidAccessError', 'SecurityError'].includes(error.name); }
    }), true);

    const parseStart = received.length;
    await page.evaluate(() => window.frameHarness.sanitizeOnly('<img src="/parser-only.png"><audio src="/parser-only.wav"></audio><video poster="/parser-only-poster.png" src="/parser-only.webm"></video>'));
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(received.slice(parseStart).some(path => path.startsWith('/parser-only')), false, 'This sanitizer-only corpus unexpectedly fetched resources');

    const attack = '<p>Attack retained text</p><script>parent.attacked=true</script><img src="/missing" onerror="parent.attacked=true"><iframe srcdoc="<script>parent.attacked=true</script>"></iframe><form action="/escaped"><input name="owned"></form><base href="https://evil.invalid"><meta http-equiv="refresh" content="0;url=/escaped"><svg onload="parent.attacked=true"></svg><a href="javascript:parent.attacked=true" target="_top">Bad link</a>';
    await page.evaluate(value => window.frameHarness.update({value, title: 'Attack'}), attack);
    frame = await documentFrame(page, 'Attack retained text');
    assert.equal(await frame.locator('script, iframe, form, input, base, meta, svg, [onerror], [onload], [target]').count(), 0);
    assert.equal(await frame.locator('a').getAttribute('href'), null);
    assert.equal(await page.evaluate(() => window.attacked), undefined);
    // Browser evaluation is privileged; inserting an actual script still tests
    // the document's sandbox and inherited CSP enforcement.
    if (!suffix) await frame.evaluate(() => {
      const script = document.createElement('script');
      script.nonce = 'frame-test';
      script.textContent = 'globalThis.sandboxScriptExecuted=true';
      document.body.append(script);
    });
    assert.equal(await frame.evaluate(() => globalThis.sandboxScriptExecuted), undefined);

    const original = await page.locator('iframe').elementHandle();
    await page.evaluate(() => window.frameHarness.update({value: '<p>Updated document</p>', title: 'Updated'}, 'callback'));
    frame = await documentFrame(page, 'Updated document');
    assert.equal(await original.evaluate(element => element === document.querySelector('iframe')), true);
    assert.equal(await page.evaluate(() => window.frameHarness.status().callbackCurrent), true);
    await page.evaluate(() => window.frameHarness.update({value: '<p>Another update</p>', title: 'Updated'}, 'callback'));
    await documentFrame(page, 'Another update');
    assert.equal(await original.evaluate(element => element === document.querySelector('iframe')), true);
    await page.evaluate(() => window.frameHarness.update({value: '', title: 'Empty'}, 'none'));
    await page.waitForFunction(() => document.querySelector('iframe').getAttribute('srcdoc') === '');
    assert.equal((await page.evaluate(() => window.frameHarness.status())).callbackValues.at(-1), null);

    const forbidden = {
      SRC: '/escaped', srcdoc: '<p>forged</p>', Sandbox: 'allow-scripts', REFERRERPOLICY: 'unsafe-url',
      src: '/escaped', srcDoc: '<script>parent.attacked=true</script>', sandbox: 'allow-scripts allow-same-origin',
      referrerPolicy: 'unsafe-url', allow: 'camera *', name: 'owned', children: 'unsafe',
      dangerouslySetInnerHTML: {__html: 'unsafe'}, style: {display: 'none'}, onLoad: 'unsafe',
      allowFullScreen: true, credentialless: true, 'data-command': 'delete',
    };
    for (const [key, value] of Object.entries(forbidden)) {
      await page.evaluate(({key, value}) => window.frameHarness.update({value: '<p>safe</p>', title: 'Invalid', [key]: value}, 'none', true), {key, value});
      await page.locator('#failure').waitFor();
      assert.equal(await page.locator('iframe').count(), 0, `${name}: accepted forged ${key}`);
    }
    for (const value of [null, 42, {}, ['raw']]) {
      await page.evaluate(value => window.frameHarness.update({value, title: 'Invalid'}, 'none', true), value);
      await page.locator('#failure').waitFor();
      assert.equal(await page.locator('iframe').count(), 0);
    }
    await page.evaluate(() => window.frameHarness.update({value: '<p>Final document</p>', title: 'Final'}, 'callback', true));
    await documentFrame(page, 'Final document');
    if ((await page.evaluate(() => window.frameHarness.status())).reactMajor >= 19) {
      await page.evaluate(() => window.frameHarness.update({value: '<p>Cleanup document</p>', title: 'Cleanup'}, 'cleanup'));
      await documentFrame(page, 'Cleanup document');
      const before = await page.evaluate(() => window.frameHarness.status().cleanups);
      await page.evaluate(() => window.frameHarness.update({value: '<p>Final document</p>', title: 'Final'}, 'callback'));
      await documentFrame(page, 'Final document');
      assert.equal(await page.evaluate(() => window.frameHarness.status().cleanups), before + 1);
    }
    await page.evaluate(() => window.frameHarness.unmount());
    assert.equal(await page.locator('iframe').count(), 0);
    assert.equal((await page.evaluate(() => window.frameHarness.status())).callbackValues.at(-1), null);
  } finally {
    if (name === 'chromium') coverage.push(...await page.coverage.stopJSCoverage());
    await page.close();
  }
}

/** CSP inherited by srcdoc blocks real image and media requests. */
async function verifyBlocked(browser) {
  const page = await browser.newPage();
  try {
    const start = received.length;
    await page.goto(`${origin}/nested/page?blocked`);
    await page.waitForFunction(() => window.frameHarness?.ready());
    const frame = await documentFrame(page, 'Readable content');
    const image = await frame.locator('img').first().evaluate(image => image.decode().then(() => 'loaded', () => 'blocked'));
    assert.equal(image, 'blocked');
    assert.equal(await loadMedia(frame), 'blocked');
    assert.equal(await loadMedia(frame, 'video'), 'blocked');
    assert.equal(received.slice(start).some(path => path.startsWith('/assets/')), false);
  } finally { await page.close(); }
}

/** A host's explicit Referrer-Policy also governs the embedded media. */
async function verifyReferrer(browser) {
  const page = await browser.newPage();
  try {
    const start = requestDetails.length;
    await page.goto(`${origin}/nested/page?no-referrer`);
    await page.waitForFunction(() => window.frameHarness?.ready());
    const frame = await documentFrame(page, 'Readable content');
    await frame.locator('img').first().evaluate(image => image.decode());
    assert.equal(await loadMedia(frame), 'loaded');
    const media = requestDetails.slice(start).filter(request => request.path.startsWith('/assets/'));
    assert(media.some(request => request.path.endsWith('.wav')));
    assert(media.some(request => request.path.endsWith('.png')));
    assert(media.every(request => request.referer === undefined));
  } finally { await page.close(); }
}

try {
  for (const name of (process.env.FRAME_BROWSERS ?? 'chromium,firefox,webkit').split(',')) {
    const engine = {chromium, firefox, webkit}[name];
    assert.ok(engine, `Unknown browser ${name}`);
    const browser = await engine.launch({headless: true});
    try {
      await verify(browser, name);
      await verifyBlocked(browser);
      await verifyReferrer(browser);
      if (name === 'chromium') {
        await verify(browser, name, '?tt=allowed');
        for (const tt of ['denied', 'sink-denied']) {
          const page = await browser.newPage();
          try {
            await page.coverage.startJSCoverage({resetOnNavigation: false});
            await page.goto(`${origin}/nested/page?tt=${tt}`);
            await page.locator('#failure').waitFor();
            assert.equal(await page.locator('iframe').count(), 0, `${tt}: Trusted Types denial must fail closed`);
            assert.match(await page.locator('#failure').textContent(), /sanitize|Trusted|policy|safe/i);
          } finally {
            coverage.push(...await page.coverage.stopJSCoverage());
            await page.close();
          }
        }
      }
      console.log(`${name} ${browser.version()}: sandbox, CSP, content, hydration, refs, updates, and invalid inputs passed`);
    } finally { await browser.close(); }
  }
} finally {
  if (coverage.length) await writeFile(new URL('chromium-v8-coverage.json', output), JSON.stringify(coverage));
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
