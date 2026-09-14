import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {build} from 'esbuild';
import {chromium, firefox, webkit} from 'playwright-core';

const directory = new URL('../', import.meta.url);
// Local fixtures are generated with ffmpeg from lavfi color/sine sources:
// 16x16 blue PNG; 0.5s libvpx WebM; 0.25s 440Hz pcm_s16le WAV.
const output = new URL('tmp/browser-sanitize/', directory);
await mkdir(output, {recursive: true});
const bundleOptions = {bundle: true, platform: 'browser', conditions: ['browser'], format: 'iife', minify: true, write: false, metafile: true, define: {'process.env.NODE_ENV': '"production"', 'process.env': '{}'}};
const bundles = {};
for (const name of ['app', 'baseline', 'measure', 'worker']) {
  bundles[name] = await build({...bundleOptions, ...(name === 'app' ? {sourcemap: 'external', outfile: new URL('app.js', output).pathname} : {}), entryPoints: [new URL(`tests/browser-sanitize/${name}.mjs`, directory).pathname]});
  const forbidden = Object.keys(bundles[name].metafile.inputs).filter(path => /(?:^|\/)(?:jsdom|isomorphic-dompurify)(?:\/|$)/.test(path));
  assert.deepEqual(forbidden, [], `${name}: Node dependency in browser graph`);
}
for (const file of bundles.app.outputFiles) await writeFile(file.path, file.contents);
bundles.edge = await build({...bundleOptions, conditions: ['edge-light', 'browser'], entryPoints: [new URL('tests/browser-sanitize/edge.mjs', directory).pathname]});
assert.deepEqual(Object.keys(bundles.edge.metafile.inputs).filter(path => /(?:^|\/)(?:jsdom|isomorphic-dompurify|dompurify)(?:\/|$)/.test(path)), [], 'Edge graph must exclude DOM engines');
const report = {environment: {node: process.version, platform: process.platform, arch: process.arch}, bundle: {incrementalBytes: bundles.measure.outputFiles[0].contents.length - bundles.baseline.outputFiles[0].contents.length, incrementalGzipBytes: gzipSync(bundles.measure.outputFiles[0].contents).length - gzipSync(bundles.baseline.outputFiles[0].contents).length}, engines: []};
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/' || path === '/engine-failure') {
    const trustedTypesPolicy = path === '/engine-failure' ? "; require-trusted-types-for 'script'; trusted-types 'none'" : '';
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'nonce-sanitizer-test'; img-src 'self'; media-src 'self'; connect-src 'self'; worker-src 'self'; base-uri 'none'; object-src 'none'; frame-src 'none'" + trustedTypesPolicy);
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><meta charset="utf-8"><title>Sanitizer browser regression</title><div id="root"></div><button id="play">Play</button><script nonce="sanitizer-test" src="/app.js"></script>');
  } else if (path === '/app.js' || path === '/worker.js' || path === '/edge.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(bundles[path.slice(1, -3)].outputFiles.find(file => !file.path.endsWith('.map')).contents);
  } else if (/^\/assets\/(pixel\.png|tone\.wav|clip\.webm)$/.test(path)) {
    response.setHeader('Content-Type', {'png': 'image/png', 'wav': 'audio/wav', 'webm': 'video/webm'}[path.split('.').at(-1)]);
    response.end(await readFile(new URL(`tests/browser-sanitize${path}`, directory)));
  } else { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

async function display(page, dirty, entry) {
  entry.phase = 'parser';
  await page.evaluate(dirty => window.sanitizeHarness.sanitize(dirty), dirty);
  await page.waitForTimeout(30);
  entry.phase = 'display';
  await page.evaluate(() => window.sanitizeHarness.display());
  await page.waitForTimeout(30);
}

async function inspect(page) {
  return page.locator('#root').evaluate(root => ({text: root.textContent, html: root.innerHTML, elements: [...root.querySelectorAll('*')].map(element => ({tag: element.localName, namespace: element.namespaceURI, parent: element.parentElement.localName, attributes: Object.fromEntries([...element.attributes].map(attribute => [attribute.name, attribute.value]))}))}));
}

async function runEngine(name, engine) {
  const entry = {name, requests: [], csp: [], errors: [], phase: 'setup'};
  report.engines.push(entry);
  const browser = await engine.launch({headless: true});
  entry.version = browser.version();
  try {
    const page = await browser.newPage();
    if (name === 'chromium') await page.coverage.startJSCoverage({resetOnNavigation: false, reportAnonymousScripts: false});
    page.on('pageerror', error => entry.errors.push(error.message));
    await page.exposeFunction('recordCsp', event => entry.csp.push({...event, phase: entry.phase}));
    await page.addInitScript(() => document.addEventListener('securitypolicyviolation', event => window.recordCsp({blockedURI: event.blockedURI, directive: event.effectiveDirective, disposition: event.disposition})));
    page.on('request', request => entry.requests.push({url: request.url(), phase: entry.phase}));
    await page.goto(origin);
    // Real workers exercise missing-DOM rejection. The private factory's
    // isSupported=false branch would require a deficient DOM implementation;
    // these supported engines cannot reach it without a test double.
    const workerResult = await page.evaluate(() => new Promise((resolve, reject) => {
      const worker = new Worker('/worker.js');
      worker.onmessage = event => { worker.terminate(); resolve(event.data); };
      worker.onerror = event => { worker.terminate(); reject(new Error(event.message)); };
      worker.postMessage('sanitize');
    }));
    assert.equal(workerResult.rejected, true);
    assert.match(workerResult.message, /DOM|browser|supported/i);
    await page.evaluate(() => window.sanitizeHarness.contract());
    await page.evaluate(() => window.sanitizeHarness.poisonApplicationPurifier());
    await display(page, '<p>private</p><iframe src="/forbidden"></iframe><img src="/assets/pixel.png">', entry);
    assert.equal(await page.locator('#root iframe, #root [onclick]').count(), 0);
    await page.locator('#root img').evaluate(image => image.decode());
    assert.equal(await page.locator('#root img').evaluate(image => image.naturalWidth), 16);

    const structure = '<div><span>span</span><figure><img src="/assets/pixel.png" alt="Warning: hot"><figcaption>caption</figcaption></figure><mark>mark</mark><sub>sub</sub><sup>sup</sup><dl><dt>term</dt><dd>definition</dd></dl><h1>1</h1><h2>2</h2><h3>3</h3><h4>4</h4><h5>5</h5><h6>6</h6><blockquote><p><a href="/read">link</a><b>b</b><br><code>code</code><del>del</del><em>em</em><hr><i>i</i><s>s</s><strong>strong</strong><u>u</u></p></blockquote><ol><li>one</li></ol><ul><li>two</li></ul><pre>pre</pre><table><caption>table</caption><thead><tr><th>head</th></tr></thead><tbody><tr><td>cell</td></tr></tbody><tfoot><tr><td>foot</td></tr></tfoot></table></div>';
    await display(page, structure.replace(/<([a-z][a-z0-9]*)/g, '<$1 title="Warning: hot" aria-label="Warning: hot" id="owned" name="owned" data-highlight-id="owned" onclick="window.attacked=true" class="supplied" style="color:red" headers="root" aria-describedby="root"'), entry);
    const content = await inspect(page);
    for (const tag of 'a b blockquote br caption code del em h1 h2 h3 h4 h5 h6 hr i li ol p pre s strong table tbody td tfoot th thead tr u ul div span figure figcaption mark sub sup dl dt dd img'.split(' ')) assert(content.elements.some(element => element.tag === tag), `${name}: missing ${tag}`);
    for (const element of content.elements) assert.equal(element.namespace, 'http://www.w3.org/1999/xhtml');
    for (const element of content.elements.slice(1)) {
      // HTML's p/hr recovery can create an additional empty paragraph.
      if (element.attributes.title !== undefined) {
        assert.equal(element.attributes.title, 'Warning: hot');
        assert.equal(element.attributes['aria-label'], 'Warning: hot');
      }
      for (const attribute of ['id', 'name', 'data-highlight-id', 'onclick', 'class', 'style', 'headers', 'aria-describedby']) assert(!(attribute in element.attributes), `${name}: ${attribute} retained on ${element.tag}`);
    }

    const badUrls = ['javascript:alert(1)', 'java&#x73;cript:alert(1)', 'data:image/svg+xml,&lt;svg onload=alert(1)&gt;', 'blob:https://example.com/id', '//evil.example/x', 'https://user:pass@example.com/x', 'relative.png', '#fragment', '/bad&#10;path', '/bad\\path'];
    for (const url of badUrls) {
      await display(page, `<a href="${url}">link</a><img src="${url}" alt="retained"><audio src="${url}"><source src="${url}"></audio><video src="${url}" poster="${url}"></video>`, entry);
      const value = await inspect(page);
      for (const element of value.elements) for (const attribute of ['href', 'src', 'poster', 'rel']) assert(!(attribute in element.attributes), `${name}: unsafe ${attribute}: ${url}`);
      assert.equal(await page.locator('#root source').count(), 0);
      assert.equal(await page.locator('#root img').getAttribute('alt'), 'retained');
    }
    await display(page, '<p title="Warning: hot" aria-label="Warning: hot" id="root" name="owned" class="x" style="color:red" data-highlight-id="owned" aria-describedby="root" headers="root" href="/leak" alt="leak">text</p><img src="/assets/pixel.png" alt="Warning: hot" title="Warning: hot" aria-label="Warning: hot" width="00016" height="16" srcset="/bad 2x" loading="eager" referrerpolicy="unsafe-url"><table><tr><th scope="row" abbr="Warning: hot" colspan="001" rowspan="1000">cell</th></tr></table><a href="/read" rel="opener" target="_blank" download ping="/bad">relative</a><a href="mailto:me@example.com">mail</a><a href="tel:+14155551212">phone</a>', entry);
    const attrs = await inspect(page);
    assert.deepEqual(attrs.elements.find(e => e.tag === 'p').attributes, {title: 'Warning: hot', 'aria-label': 'Warning: hot'});
    assert.equal(await page.locator('#root img').getAttribute('width'), '16');
    assert.equal(await page.locator('#root img').getAttribute('referrerpolicy'), 'no-referrer');
    assert.equal(await page.locator('#root img').getAttribute('alt'), 'Warning: hot');
    assert.equal(await page.locator('#root th').getAttribute('abbr'), 'Warning: hot');
    assert.equal(await page.locator('#root th').getAttribute('colspan'), '1');
    for (const a of await page.locator('#root a').all()) assert.equal(await a.getAttribute('rel'), 'nofollow noopener noreferrer');
    await display(page, '<a href="https://EXAMPLE.com:443/a?x=1&amp;y=2">absolute</a><img src="https://EXAMPLE.com:443/a.png" width="10000" height="1"><video width="00001" height="10000" poster="/assets/pixel.png"></video><table><tr><td colspan="1000" rowspan="00001" scope="colgroup">cell</td></tr></table>', entry);
    assert.equal(await page.locator('#root a').getAttribute('href'), 'https://example.com/a?x=1&y=2');
    assert.equal(await page.locator('#root img').getAttribute('src'), 'https://example.com/a.png');
    assert.equal(await page.locator('#root img').getAttribute('width'), '10000');
    assert.equal(await page.locator('#root video').getAttribute('width'), '1');
    assert.equal(await page.locator('#root td').getAttribute('rowspan'), '1');
    for (const scope of ['row', 'col', 'rowgroup', 'colgroup']) {
      await display(page, `<table><tr><td scope="${scope}">cell</td></tr></table>`, entry);
      assert.equal(await page.locator('#root td').getAttribute('scope'), scope);
    }
    await display(page, '<table><tr><td scope="ROW" colspan="1001" rowspan="1001">cell</td></tr></table><p abbr="leak" scope="row" width="5" height="5" src="/assets/pixel.png" poster="/assets/pixel.png" type="audio/wav" controls preload="none">paragraph</p><audio poster="/assets/pixel.png" width="5" height="5"><source><source type="audio/wav"><span><source src="/assets/tone.wav"></span></audio>', entry);
    assert.equal(await page.locator('#root td').getAttribute('scope'), null);
    assert.equal(await page.locator('#root [colspan], #root [rowspan], #root source').count(), 0);
    assert.deepEqual((await inspect(page)).elements.find(element => element.tag === 'p').attributes, {});
    assert.equal(await page.locator('#root audio').getAttribute('poster'), null);
    assert.equal(await page.locator('#root audio').getAttribute('width'), null);
    assert.equal(await page.locator('#root audio').getAttribute('height'), null);
    for (const invalid of ['', '0', '-1', '+2', '1.5', '1e2', '2px', ' 2', '2 ', '10001', '١']) {
      await display(page, `<img width="${invalid}" height="${invalid}"><table><tr><td colspan="${invalid}" rowspan="${invalid}">cell</td></tr></table>`, entry);
      assert.equal(await page.locator('#root [width], #root [height], #root [colspan], #root [rowspan]').count(), 0, `${name}: invalid integer ${invalid}`);
    }

    const attacks = [
      '<script>window.attacked=true</script><img src="/missing" onerror="window.attacked=true"><style>body{color:red}</style><form><input name="root"></form><iframe srcdoc="<script>parent.attacked=true</script>"></iframe><object data="/bad"></object><embed src="/bad"><base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=/bad"><template><img src="/bad"></template>',
      '<svg><foreignObject><p onclick="window.attacked=true">bad</p></foreignObject></svg><math><mtext><table><mglyph><style><!--</style><img title="--><img src=/bad onerror=window.attacked=true>">',
      '<table><caption><svg><desc><table><img src="/bad" onerror="window.attacked=true"></table></desc></svg></caption></table>',
      '<math><mtext><option><FAKEFAKE><option></option><mglyph><svg><mtext><style><a title="</style><img src=/bad onerror=window.attacked=true>">',
      '<custom-widget><b>safe ordinary children</b></custom-widget><div id="sanitizeHarness" name="root" data-command="delete" aria-controls="root"><mark data-highlight-id="private">imported</mark></div>',
    ];
    for (const dirty of attacks) {
      await display(page, dirty, entry);
      const parsed = await inspect(page);
      assert.equal(await page.evaluate(() => window.attacked), undefined);
      for (const element of parsed.elements) {
        assert.equal(element.namespace, 'http://www.w3.org/1999/xhtml');
        assert(!'script style form input iframe object embed base meta template svg math custom-widget'.split(' ').includes(element.tag));
        for (const attribute of Object.keys(element.attributes)) assert(!/^(on|data-)|^(id|name|style|class|aria-controls)$/.test(attribute), `${name}: unsafe ${attribute}`);
      }
    }

    for (const type of ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm', 'video/mp4', 'video/ogg', 'video/webm']) {
      await display(page, `<audio><source src="/assets/tone.wav" type="${type}"></audio>`, entry);
      assert.equal(await page.locator('#root source').getAttribute('type'), type);
    }
    for (const type of ['Audio/Wav', 'audio/wav; codecs=1', ' audio/wav', 'application/javascript']) {
      await display(page, `<video><source src="/assets/clip.webm" type="${type}"></video>`, entry);
      assert.equal(await page.locator('#root source').getAttribute('type'), null);
    }
    await display(page, '<source src="/assets/tone.wav"><audio autoplay loop preload="auto"><source src="/assets/tone.wav" type="application/javascript"><span><source src="/assets/tone.wav"></span><a href="/assets/tone.wav">Download</a></audio><video src="/assets/clip.webm" poster="/assets/pixel.png" width="16" height="16" autoplay loop></video>', entry);
    assert.equal(await page.locator('#root source').count(), 1);
    assert.equal(await page.locator('#root source').getAttribute('type'), null);
    assert.equal(await page.locator('#root a').getAttribute('href'), '/assets/tone.wav');
    for (const media of await page.locator('#root audio, #root video').all()) {
      assert.equal(await media.getAttribute('preload'), 'none');
      assert.equal(await media.getAttribute('autoplay'), null);
      assert.equal(await media.getAttribute('loop'), null);
      assert.equal(await media.evaluate(element => element.controls), true);
    }
    entry.codecs = await page.evaluate(() => ({wav: document.createElement('audio').canPlayType('audio/wav; codecs="1"'), webm: document.createElement('video').canPlayType('video/webm; codecs="vp8"'), ogg: document.createElement('video').canPlayType('video/ogg; codecs="theora"')}));
    entry.media = [];
    for (const [tag, codec] of [['audio', 'wav'], ['video', 'webm']]) {
      if (!entry.codecs[codec]) { entry.media.push({tag, status: 'codec unavailable'}); continue; }
      const readiness = await page.locator(`#root ${tag}`).evaluate(element => new Promise((resolve, reject) => {
        const seen = [];
        const timer = setTimeout(() => reject(new Error('Media readiness timeout')), 10000);
        element.addEventListener('loadedmetadata', () => seen.push('loadedmetadata'), {once: true});
        element.addEventListener('canplay', () => { clearTimeout(timer); seen.push('canplay'); resolve(seen); }, {once: true});
        element.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`Media decode error ${element.error?.code}`)); }, {once: true});
        element.load();
      }));
      assert(readiness.includes('loadedmetadata'));
      await page.evaluate(tag => {
        document.getElementById('play').onclick = () => {
          const media = document.querySelector(`#root ${tag}`);
          window.playResult = media.play().then(() => { media.pause(); return 'played'; }, error => error.name);
        };
      }, tag);
      await page.locator('#play').click();
      const playback = await page.evaluate(() => window.playResult);
      assert.equal(playback, 'played');
      entry.media.push({tag, readiness, playback});
    }
    await display(page, '<img src="https://blocked.invalid/image.png"><video poster="https://blocked.invalid/poster.png" src="https://blocked.invalid/video.webm"></video>', entry);
    await page.waitForTimeout(100);
    assert(entry.csp.some(event => event.phase === 'display' && event.directive === 'img-src' && event.disposition === 'enforce'), `${name}: CSP did not block external images`);
    const coverage = name === 'chromium' ? await page.coverage.stopJSCoverage() : [];
    entry.performance = await page.evaluate(() => window.sanitizeHarness.timing());
    assert.deepEqual(entry.errors, []);
    if (name === 'chromium') {
      await page.coverage.startJSCoverage({resetOnNavigation: false, reportAnonymousScripts: false});
      entry.phase = 'engine-failure';
      await page.goto(`${origin}/engine-failure`);
      const failure = await page.evaluate(() => {
        try {
          window.sanitizeHarness.sanitize('<img src="/missing" onerror="window.attacked=true">');
          return {rejected: false};
        } catch (error) { return {rejected: true, message: error.message}; }
      });
      assert.equal(failure.rejected, true, 'Trusted Types denial must not return unsanitized HTML');
      assert.match(failure.message, /sanitizeUserHtml engine failed/);
      entry.engineFailure = failure;
      await writeFile(new URL('chromium-v8-coverage.json', output), JSON.stringify([...coverage, ...await page.coverage.stopJSCoverage()]));
    }
    entry.status = 'passed';
  } finally { await browser.close(); }
}

try {
  for (const [name, engine] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) await runEngine(name, engine);
} finally {
  await new Promise(resolve => server.close(resolve));
  await writeFile(new URL('results.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
