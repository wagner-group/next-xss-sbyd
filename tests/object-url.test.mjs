import assert from 'node:assert/strict';
import {test} from 'node:test';
import {renderToString} from 'react-dom/server';
import {createElement} from 'react';
import {createPassiveObjectUrl, PassiveObjectUrlPreview, PassiveObjectUrlDownload} from 'next-xss-sbyd/object-url';

test('object URL creation requires a browser document, including when Node offers native Blob URLs', () => {
  assert.throws(() => createPassiveObjectUrl(new Blob(['x'], {type:'image/png'}), 'download'), /browser document/);
});
test('server rendering adapters allocate no object URL and emit no blob URL', () => {
  const blob = new Blob(['x'], {type:'image/png'});
  assert.equal(renderToString(createElement(PassiveObjectUrlPreview, {blob, alt:'preview'})), '<img alt="preview"/>');
  assert.equal(renderToString(createElement(PassiveObjectUrlDownload, {blob, filename:'image.png'}, 'Download')), '<a>Download</a>');
});

test('invalid download filenames fail during render, before a browser effect can allocate', () => {
  const blob = new Blob(['x'], {type:'image/png'});
  for (const filename of [undefined, null, '', 42, new String('image.png')]) {
    assert.throws(() => renderToString(createElement(PassiveObjectUrlDownload, {blob, filename}, 'Download')), TypeError);
  }
});

test('preview alt retains ordinary React escaping and untyped caller behavior', () => {
  const blob = new Blob(['x'], {type:'image/png'});
  for (const alt of ['', '<script>alert(1)</script>', 123, null, undefined]) {
    assert.equal(renderToString(createElement(PassiveObjectUrlPreview, {blob, alt})),
      renderToString(createElement('img', {alt})));
  }
});
