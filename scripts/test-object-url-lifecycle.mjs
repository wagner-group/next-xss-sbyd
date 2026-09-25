import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname} from 'node:path';
import {build} from 'esbuild';
import {chromium, firefox, webkit} from 'playwright-core';

const workspaceRequire = createRequire(new URL('../package.json', import.meta.url));
const legacyRequire = createRequire(new URL('../fixtures/next14/package.json', import.meta.url));
const pixel = [...await readFile('tests/browser-sanitize/assets/pixel.png')];
const report = [];
await mkdir('tmp/object-url-lifecycle', {recursive: true});

for (const [major, resolve] of [[18, legacyRequire], [19, workspaceRequire]]) {
  assert.equal(Number(resolve('react/package.json').version.split('.')[0]), major,
    'Install the Next 14 fixture dependencies before running the React 18 matrix');
  const outfile = `tmp/object-url-lifecycle/react${major}.js`;
  await build({
    entryPoints: ['tests/browser-object-url.mjs'], bundle: true, platform: 'browser', format: 'iife', outfile,
    alias: {react: dirname(resolve.resolve('react/package.json')), 'react-dom': dirname(resolve.resolve('react-dom/package.json'))},
    define: {'process.env.NODE_ENV': '"development"', 'process.env': '{}'},
  });
  const bundle = await readFile(outfile);
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/app.js' ? bundle : '<div id="root"></div><script src="/app.js"></script>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const [name, engine] of Object.entries({chromium, firefox, webkit})) {
      const browser = await engine.launch({headless: true});
      try {
        const page = await browser.newPage({acceptDownloads: true});
        page.setDefaultTimeout(15000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin);
        assert.equal(Number((await page.evaluate(() => window.reactVersion)).split('.')[0]), major);
        for (const mode of ['preview', 'download']) {
          for (const hydrate of [false, true]) {
            await page.evaluate(({pixel, mode, hydrate}) => window.startLifecycle(pixel, mode, hydrate), {pixel, mode, hydrate});
            const selector = mode === 'preview' ? '#root img' : '#root a';
            const attribute = mode === 'preview' ? 'src' : 'href';
            await page.waitForFunction(({selector, attribute}) => document.querySelector(selector)?.getAttribute(attribute)?.startsWith('blob:'), {selector, attribute});
            const original = await page.locator(selector).getAttribute(attribute);
            await page.evaluate(url => window.guardRawObjectUrls(url), original);
            if (mode === 'preview') await page.locator(selector).evaluate(img => img.decode());
            // A non-resource prop update must not create a replacement capability.
            await page.evaluate(mode => window.updateLifecycle(mode === 'preview' ? {alt: 'changed'} : {children: 'Changed'}), mode);
            assert.equal(await page.locator(selector).getAttribute(attribute), original);
            if (mode === 'preview') {
              assert.equal(await page.locator(selector).getAttribute('alt'), 'changed');
              for (const alt of [123, null, undefined, '']) {
                await page.evaluate(alt => window.updateLifecycle({alt}), alt);
                assert.equal(await page.locator(selector).getAttribute(attribute), original);
                assert.equal(await page.locator(selector).getAttribute('alt'), alt == null ? null : String(alt));
              }
            } else {
              assert.equal(await page.locator(selector).textContent(), 'Changed');
              await assertDownload(page, pixel, 'original.png');
            }
            await page.evaluate(pixel => window.updateLifecycle({}, [...pixel, 0]), pixel);
            const replacement = await page.locator(selector).getAttribute(attribute);
            assert.notEqual(replacement, original);
            await assertRevoked(page, original);
            await page.evaluate(() => window.unmount());
            await assertRevoked(page, replacement);
          }
        }
        for (const capture of [false, true]) {
          await page.evaluate(pixel => window.startLifecycle(pixel, 'download'), pixel);
          const unmountedUrl = await page.locator('#root a').getAttribute('href');
          await page.evaluate(capture => {
            const target = capture ? document.getElementById('root') : document.querySelector('#root a');
            target.addEventListener('click', () => window.unmount(), {capture, once: true});
          }, capture);
          await assertDownload(page, pixel, 'original.png');
          await assertRevoked(page, unmountedUrl);
          for (const change of ['blob', 'filename']) {
            await page.evaluate(pixel => window.startLifecycle(pixel, 'download'), pixel);
            const original = await page.locator('#root a').getAttribute('href');
            const replacementBytes = [...pixel, 0];
            await page.evaluate(({capture, change, replacementBytes}) => {
              const target = capture ? document.getElementById('root') : document.querySelector('#root a');
              target.addEventListener('click', () => window.updateLifecycle(
                change === 'filename' ? {filename: 'changed.png'} : {},
                change === 'blob' ? replacementBytes : undefined), {capture, once: true});
            }, {capture, change, replacementBytes});
            // The same native anchor now points at the newly committed resource.
            await assertDownload(page, change === 'blob' ? replacementBytes : pixel,
              change === 'filename' ? 'changed.png' : 'original.png');
            const replacement = await page.locator('#root a').getAttribute('href');
            assert.notEqual(replacement, original);
            await assertRevoked(page, original);
            assert.equal(await page.locator('#root a').getAttribute('href'), replacement);
            await page.evaluate(() => window.unmount());
            await assertRevoked(page, replacement);
          }
        }
        assert.deepEqual(errors, [], 'Lifecycle and hydration must not produce browser errors');
        for (const filename of ['', null, undefined, 42]) {
          await page.evaluate(filename => window.invalidFilename(filename), filename);
          await page.waitForFunction(() => window.validationError !== undefined);
          assert.deepEqual(await page.evaluate(() => window.validationError), {
            type: 'TypeError', message: 'Expected an HTML anchor and a nonempty download filename',
          });
          assert.equal(await page.locator('#root a').count(), 0);
          await page.evaluate(() => window.unmount());
        }
        for (const url of await page.evaluate(() => [...new Set(window.observedUrls)])) await assertRevoked(page, url);
        report.push({engine: name, version: browser.version(), react: await page.evaluate(() => window.reactVersion), status: 'passed'});
        console.log(report.at(-1));
      } finally { await browser.close(); }
    }
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await writeFile('tmp/object-url-lifecycle/results.json', JSON.stringify(report, null, 2));
  }
}

async function assertDownload(page, bytes, filename) {
  const event = page.waitForEvent('download');
  await page.locator('#root a').click();
  const download = await event;
  assert.equal(download.suggestedFilename(), filename);
  assert.equal(await download.failure(), null);
  assert.deepEqual([...await readFile(await download.path())], bytes);
}

async function assertRevoked(page, url) {
  await page.waitForFunction(async url => { try { await fetch(url); return false; } catch { return true; } }, url);
}
