import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium, firefox, webkit} from 'playwright-core';
import {createContentSecurityPolicy} from 'next-xss-sbyd/csp';

await mkdir('tmp/object-url', {recursive:true});
await build({entryPoints:['tests/browser-object-url.mjs'], bundle:true, platform:'browser', define:{'process.env.NODE_ENV':'"development"', 'process.env':'{}'}, format:'iife', outfile:'tmp/object-url/app.js'});
const bundle = await readFile('tmp/object-url/app.js');
const pixel = [...await readFile('tests/browser-sanitize/assets/pixel.png')];
const executed = new Set();
const nonce = 'object-url-browser-csp';
const previousEnvironment = process.env.NODE_ENV;
process.env.NODE_ENV = 'production';
const policies = {
  '/csp': createContentSecurityPolicy(nonce),
  '/csp-blob': createContentSecurityPolicy(nonce, {imgSrc:["'self'", 'blob:']}),
};
if (previousEnvironment === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = previousEnvironment;
assert(!policies['/csp'].includes("'unsafe-eval'"));
const server = createServer((req, res) => {
  if (req.url.startsWith('/executed')) { executed.add(req.url); res.end(); }
  else if (req.url === '/app.js') { res.setHeader('Content-Type','text/javascript'); res.end(bundle); }
  else {
    if (policies[req.url]) res.setHeader('Content-Security-Policy', policies[req.url]);
    res.setHeader('Content-Type','text/html');
    res.end(`<div id="root"></div><script nonce="${nonce}" src="/app.js"></script>`);
  }
});
server.listen(0, '127.0.0.1');
await once(server,'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const report = [];
try {
  for (const [name, engine] of Object.entries({chromium, firefox, webkit})) {
    const browser = await engine.launch({headless:true});
    try {
      const context = await browser.newContext({acceptDownloads:true});
      context.setDefaultTimeout(15000);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      if (name === 'chromium') await page.coverage.startJSCoverage({resetOnNavigation:false});
      await page.goto(origin);
      await page.evaluate(() => window.contract());
      await page.evaluate(async () => {
        const frame = document.createElement('iframe'); frame.src = '/';
        const loaded = new Promise(resolve => { frame.onload = resolve; });
        document.body.append(frame); await loaded;
        const foreign = frame.contentWindow;
        const handle = foreign.api.createPassiveObjectUrl(new foreign.Blob(['bytes'],{type:'image/png'}), 'download');
        window.rejects(() => api.attachPassiveObjectUrlDownload(document.createElement('a'),handle,'x.png'));
        window.rejects(() => api.revokePassiveObjectUrl(handle));
        foreign.api.revokePassiveObjectUrl(handle); frame.remove();
      });
      // Actual retrieval proves revocation; no monkeypatching URL methods or mocks.
      await page.evaluate(async () => {
        const h = api.createPassiveObjectUrl(new Blob(['bytes'], {type:'image/png'}), 'download');
        if (await (await fetch(h.url)).text() !== 'bytes') throw new Error('fetch');
        api.revokePassiveObjectUrl(h);
        await new Promise(resolve => setTimeout(resolve,10));
        try { await fetch(h.url); } catch { return; }
        throw new Error('URL still live');
      });
      for (let i = 0; i < 3; i++) {
        await page.evaluate(pixel => window.mount(pixel,'image/png','preview'), pixel);
        await page.locator('img').evaluate(img => img.decode());
        const url = await page.locator('img').getAttribute('src');
        assert.equal(await page.locator('img').evaluate(img => img.naturalWidth),16);
        await page.evaluate(pixel => window.mount(pixel,'image/png','preview'), pixel);
        await assertRevoked(page,url);
        const replacement = await page.locator('img').getAttribute('src');
        await page.evaluate(() => window.unmount());
        await assertRevoked(page,replacement);
      }
      // Exercise each effect dependency independently on the same mounted link.
      await page.evaluate(pixel => {
        window.downloadBlob = new Blob([new Uint8Array(pixel)], {type:'image/png'});
        window.mountDownload(window.downloadBlob, 'original.png');
      }, pixel);
      for (const change of ['filename', 'blob']) {
        const previous = await page.locator('a').getAttribute('href');
        const bytes = change === 'filename' ? pixel : [...pixel, 0];
        await page.evaluate(({change, bytes}) => {
          if (change === 'blob') window.downloadBlob = new Blob([new Uint8Array(bytes)], {type:'image/png'});
          window.mountDownload(window.downloadBlob, 'replacement.png');
        }, {change, bytes});
        const replacement = await page.locator('a').getAttribute('href');
        assert.notEqual(replacement, previous);
        await assertRevoked(page, previous);
        assert.equal(await page.locator('a').getAttribute('href'), replacement);
        const event = page.waitForEvent('download');
        await page.locator('a').click();
        const download = await event;
        assert.equal(download.suggestedFilename(), 'replacement.png');
        assert.equal(await download.failure(), null);
        assert.deepEqual([...await readFile(await download.path())], bytes);
      }
      const finalDownload = await page.locator('a').getAttribute('href');
      await page.evaluate(() => window.unmount());
      await assertRevoked(page, finalDownload);
      for (const capture of [false,true]) {
        await page.evaluate(pixel => window.mount(pixel,'image/png','download'),pixel);
        const downloadUrl = await page.locator('a').getAttribute('href');
        // Cleanup can precede the anchor's listeners (ancestor capture), or run on target.
        await page.evaluate(capture => {
          const element = capture ? document.getElementById('root') : document.querySelector('a');
          element.addEventListener('click', () => window.unmount(), {capture,once:true});
        },capture);
        const downloadEvent = page.waitForEvent('download');
        await page.locator('a').click();
        const download = await downloadEvent;
        assert.equal(await download.failure(),null);
        assert.deepEqual([...await readFile(await download.path())],pixel);
        await assertRevoked(page,downloadUrl);
      }
      await page.evaluate(pixel => window.mount(pixel,'image/png','preview'),pixel);
      const beforeFailure = await page.locator('img').getAttribute('src');
      await page.evaluate(pixel => { try { window.mount(pixel,'image/png','preview',true); } catch {} },pixel);
      await assertRevoked(page,beforeFailure);
      await page.evaluate(() => window.unmount());
      await page.evaluate(pixel => window.mount(pixel,'image/png','download',false,''),pixel);
      await page.waitForFunction(() => document.querySelector('#root a') === null);
      await page.evaluate(() => window.unmount());
      assert(errors.includes('render failed'));
      assert(errors.includes('Expected an HTML anchor and a nonempty download filename'));
      assert(errors.every(error => ['render failed','Expected an HTML anchor and a nonempty download filename'].includes(error)));
      // Observe real DOM mutations, including Strict Mode's discarded first effect.
      for (const url of await page.evaluate(() => [...new Set(window.observedUrls)])) await assertRevoked(page,url);
      // Fixed image bytes keep URL decoding independent of canvas encoder support.
      for (const [type, bytes, width] of [
        ['image/png', pixel, 16],
        ['image/jpeg', [...Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==', 'base64')], 1],
        ['image/gif', [...Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')], 1],
      ]) {
        await page.evaluate(({bytes,type}) => window.mount(bytes,type,'preview'),{bytes,type});
        await page.locator('img').evaluate(img => img.decode());
        assert.equal(await page.locator('img').evaluate(img => img.naturalWidth),width);
        await page.evaluate(() => window.unmount());
        await page.evaluate(({bytes,type}) => window.mount(bytes,type,'download'),{bytes,type});
        const event = page.waitForEvent('download'); await page.locator('a').click();
        const downloaded = await event;
        assert.equal(await downloaded.failure(),null);
        assert.deepEqual([...await readFile(await downloaded.path())],bytes);
        await page.evaluate(() => window.unmount());
      }
      for (const url of await page.evaluate(() => [...new Set(window.observedUrls)])) await assertRevoked(page,url);
      // Native top-level navigation is tested independently of CSP and again
      // under the package's production policy inherited by creator-owned Blobs.
      const cases = [];
      const signatures = {
        'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
        'image/jpeg': [0xff, 0xd8, 0xff, 0xe0],
        'image/gif': [...Buffer.from('GIF89a')],
      };
      for (const policy of ['none', 'production']) {
        const creator = policy === 'none' ? origin : `${origin}/csp`;
        for (const type of Object.keys(signatures)) {
          for (const suffix of ['', '; charset="utf-8"']) {
            for (const syntax of ['html','xhtml']) {
              for (const prefixed of [false, true]) {
                const id = `${name}-${cases.length}`;
                const payload = `${syntax === 'html' ? '<!doctype html><html>' : '<html xmlns="http://www.w3.org/1999/xhtml">'}<script>globalThis.attacked=true;fetch('${origin}/executed?${id}')</script></html>`;
                const bytes = [...(prefixed ? signatures[type] : []), ...Buffer.from(payload)];
                const target = await context.newPage();
                await target.goto(creator);
                const url = await target.evaluate(({bytes,type}) => api.createPassiveObjectUrl(new Blob([new Uint8Array(bytes)],{type}), 'download').url,{bytes,type:type+suffix});
                let navigationDownload;
                target.on('download', value => { navigationDownload = value; });
                try {
                  if (policy === 'none') await target.goto(url);
                  else navigationDownload = await navigateFromPage(target, url);
                } catch (error) {
                  navigationDownload ??= await target.waitForEvent('download', {timeout:1000}).catch(() => null);
                  assert(navigationDownload, `${name} ${policy} ${type+suffix}: unexpected navigation failure: ${error.message}`);
                }
                if (navigationDownload) {
                  assert.equal(await navigationDownload.failure(),null);
                  assert.deepEqual([...await readFile(await navigationDownload.path())],bytes);
                }
                assert.notEqual(await target.evaluate(() => globalThis.attacked),true);
                assert(!executed.has(`/executed?${id}`));
                await target.close();
                cases.push({policy,type:type+suffix,syntax,prefixed});
              }
            }
          }
        }
        // The same HTML control must execute without CSP and be blocked by CSP.
        const target = await context.newPage();
        await target.addInitScript(() => {
          window.violations = [];
          document.addEventListener('securitypolicyviolation', event => window.violations.push(event.effectiveDirective));
        });
        await target.goto(creator);
        const id = `${name}-control-${policy}`;
        const control = await target.evaluate(({origin,id}) => URL.createObjectURL(new Blob([`<script>globalThis.attacked=true;fetch('${origin}/executed?${id}')</script>`],{type:'text/html'})),{origin,id});
        await navigateFromPage(target, control);
        if (policy === 'none') {
          assert.equal(await target.evaluate(() => globalThis.attacked),true);
        } else {
          await target.waitForFunction(() => window.violations.some(directive => directive.startsWith('script-src')));
          assert.notEqual(await target.evaluate(() => globalThis.attacked),true);
          assert(!executed.has(`/executed?${id}`));
        }
        await target.close();
      }
      for (const allowed of [false, true]) {
        const target = await context.newPage();
        await target.goto(`${origin}/${allowed ? 'csp-blob' : 'csp'}`);
        await target.evaluate(() => {
          window.violations = [];
          document.addEventListener('securitypolicyviolation', event => window.violations.push({directive:event.effectiveDirective, uri:event.blockedURI}));
        });
        await target.evaluate(pixel => window.mount(pixel,'image/png','preview'),pixel);
        if (allowed) {
          await target.locator('img').evaluate(img => img.decode());
          assert.equal(await target.locator('img').evaluate(img => img.naturalWidth),16);
          assert.deepEqual(await target.evaluate(() => window.violations),[]);
        } else {
          await target.waitForFunction(() => window.violations.some(event => event.directive === 'img-src' && event.uri.startsWith('blob')));
          assert.equal(await target.locator('img').evaluate(img => img.naturalWidth),0);
        }
        await target.evaluate(() => window.unmount());
        await target.close();
      }
      if (name === 'chromium') await writeFile('tmp/object-url/coverage.json', JSON.stringify(await page.coverage.stopJSCoverage()));
      report.push({engine:name,version:browser.version(),react:await page.evaluate(() => window.reactVersion),status:'passed',adversarialNavigations:cases.length});
      console.log(report.at(-1));
    } finally { await browser.close(); }
  }
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await writeFile('tmp/object-url/results.json',JSON.stringify(report,null,2));
}
async function assertRevoked(page,url) {
  await page.waitForFunction(async url => { try { await fetch(url); return false; } catch { return true; } },url);
}

// Browser-initiated page.goto(blob) does not inherit the creator's CSP in
// Chromium. Follow a real page link to exercise application-originated navigation.
async function navigateFromPage(page, url) {
  await page.evaluate(url => {
    const link = document.createElement('a');
    link.id = 'navigate-blob'; link.href = url; link.textContent = 'Navigate';
    document.body.append(link);
  }, url);
  const completed = Promise.race([
    page.waitForURL(url).then(() => undefined),
    page.waitForEvent('download'),
  ]);
  await page.locator('#navigate-blob').click();
  return completed;
}
