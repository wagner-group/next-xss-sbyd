import assert from 'node:assert/strict';
import {test} from 'node:test';
import {renderToString} from 'react-dom/server';
import {createElement} from 'react';
import {createPassiveObjectUrl, PassiveObjectUrlPreview, PassiveObjectUrlDownload} from 'next-xss-sbyd/object-url';

test('object URL creation requires a browser document, including when Node offers native Blob URLs', () => {
  assert.throws(() => createPassiveObjectUrl(new Blob(['x'], {type:'image/png'})), /browser document/);
});
test('server rendering adapters allocates no object URL and emits no blob URL', () => {
  const blob = new Blob(['x'], {type:'image/png'});
  assert.equal(renderToString(createElement(PassiveObjectUrlPreview, {blob, alt:'preview'})), '<img alt="preview"/>');
  assert.equal(renderToString(createElement(PassiveObjectUrlDownload, {blob, filename:'image.png'}, 'Download')), '<a>Download</a>');
});
