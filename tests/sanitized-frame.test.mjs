import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement, version} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {JSDOM} from 'jsdom';
import {SanitizedHtmlFrame} from 'next-xss-sbyd/sanitized-html-frame';

const props = {value: '<p>Hello <b>reader</b></p><script>parent.attacked=true</script><form action="/submit"><input></form>', title: 'Preview'};

test('SSR sanitizes a document and fixes isolation attributes', () => {
  const output = renderToStaticMarkup(createElement(SanitizedHtmlFrame, {...props, id: 'preview', width: 400, height: 200, loading: 'lazy', tabIndex: 0, role: 'document', 'aria-label': 'Article', className: 'preview'}));
  const frame = new JSDOM(output).window.document.querySelector('iframe');
  assert.equal(frame.getAttribute('sandbox'), '');
  assert.equal(frame.getAttribute('referrerpolicy'), 'no-referrer');
  assert.equal(frame.getAttribute('src'), null);
  assert.equal(frame.getAttribute('title'), 'Preview');
  assert.equal(frame.getAttribute('width'), '400');
  assert.equal(frame.getAttribute('srcdoc'), '<p>Hello <b>reader</b></p>');
});

test('SSR rejects forged props and invalid inputs', () => {
  for (const key of ['src', 'SRC', 'srcDoc', 'SrcDoc', 'sandbox', 'SANDBOX', 'dangerouslySetInnerHTML', 'DangerouslyAnything', 'children', 'referrerPolicy', 'allow', 'name', 'onLoad', 'style', 'suppressHydrationWarning']) {
    assert.throws(() => renderToStaticMarkup(createElement(SanitizedHtmlFrame, {...props, [key]: 'unsafe'})), /Unsafe SanitizedHtmlFrame prop/);
  }
  for (const value of [null, undefined, {}, 1]) {
    assert.throws(() => renderToStaticMarkup(createElement(SanitizedHtmlFrame, {...props, value})), /string/);
  }
  for (const title of [null, undefined, 1, '', '  ']) {
    assert.throws(() => renderToStaticMarkup(createElement(SanitizedHtmlFrame, {...props, title})), /title/);
  }
  assert.match(renderToStaticMarkup(createElement(SanitizedHtmlFrame, {value: '', title: 'Empty'})), /srcDoc=""/i);
});

test('server-only rendering uses the same fixed contract without client hooks', async () => {
  const server = await import('../packages/next-xss-sbyd/dist/sanitized-html-frame-server.js');
  assert.equal(renderToStaticMarkup(createElement(server.SanitizedHtmlFrame, props)), renderToStaticMarkup(createElement(SanitizedHtmlFrame, props)));
  // React 18 removes refs before invoking function components; React 19 supplies
  // them as props, where the server-only contract rejects them.
  if (Number(version.split('.')[0]) >= 19) {
    assert.throws(() => renderToStaticMarkup(createElement(server.SanitizedHtmlFrame, {...props, ref: {current: null}})), /Unsafe SanitizedHtmlFrame prop/);
  } else {
    assert.equal(renderToStaticMarkup(createElement(server.SanitizedHtmlFrame, {...props, ref: {current: null}})), renderToStaticMarkup(createElement(server.SanitizedHtmlFrame, props)));
  }
});

test('conditional server-component and Edge exports select the supported environment', async () => {
  const {execFileSync} = await import('node:child_process');
  const code = `
    import assert from 'node:assert/strict';
    import {SanitizedHtmlFrame} from 'next-xss-sbyd/sanitized-html-frame';
    const props = {value: '<b>reader</b><script>alert(1)</script>', title: 'Preview'};
    const element = SanitizedHtmlFrame(props);
    assert.equal(element.type, 'iframe');
    assert.equal(element.props.srcDoc, '<b>reader</b>');
    assert.equal(element.props.sandbox, '');
  `;
  execFileSync(process.execPath, ['--conditions=react-server', '--input-type=module', '-e', code], {stdio: 'pipe'});
  const edgeCode = `
    import assert from 'node:assert/strict';
    import {SanitizedHtmlFrame} from 'next-xss-sbyd/sanitized-html-frame';
    assert.throws(() => SanitizedHtmlFrame({value: '<b>reader</b>', title: 'Preview'}), /Edge sanitization is unsupported/);
  `;
  execFileSync(process.execPath, ['--conditions=react-server', '--conditions=edge-light', '--input-type=module', '-e', edgeCode], {stdio: 'pipe'});
});

test('browser entry fails closed without a DOM and Edge bundles omit DOM engines', async () => {
  const {execFileSync} = await import('node:child_process');
  const {build} = await import('esbuild');
  const code = `
    import assert from 'node:assert/strict';
    import {createElement, version} from 'react';
    import {renderToStaticMarkup} from 'react-dom/server';
    import {SanitizedHtmlFrame} from 'next-xss-sbyd/sanitized-html-frame';
    assert.throws(() => renderToStaticMarkup(createElement(SanitizedHtmlFrame, {value: '<b>reader</b>', title: 'Preview'})), /workers without a DOM are unsupported/);
  `;
  execFileSync(process.execPath, ['--conditions=browser', '--input-type=module', '-e', code], {stdio: 'pipe'});
  const bundle = await build({stdin: {contents: 'export {SanitizedHtmlFrame} from "next-xss-sbyd/sanitized-html-frame";', resolveDir: process.cwd()}, bundle: true, platform: 'browser', conditions: ['edge-light', 'browser'], write: false, metafile: true});
  assert.deepEqual(Object.keys(bundle.metafile.inputs).filter(path => /(?:^|\/)(?:jsdom|dompurify)(?:\/|$)/.test(path)), []);
});
