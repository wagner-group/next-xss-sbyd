import React, {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import * as api from 'next-xss-sbyd/object-url';
import {navigationUrl, resourceUrl} from 'next-xss-sbyd';
window.api = api;
window.observedUrls = [];
const observer = new MutationObserver(records => {
  for (const record of records) {
    if (record.oldValue?.startsWith('blob:')) window.observedUrls.push(record.oldValue);
    const current = record.target.getAttribute(record.attributeName);
    if (current?.startsWith('blob:')) window.observedUrls.push(current);
  }
});
observer.observe(document.getElementById('root'), {subtree:true, attributes:true, attributeOldValue:true, attributeFilter:['src','href']});
window.rejects = function rejects(fn) {
  try { fn(); } catch (error) { if (error instanceof TypeError) return; throw error; }
  throw new Error('Expected TypeError');
};
window.contract = function contract() {
  const {createPassiveObjectUrl: create, revokePassiveObjectUrl: revoke, attachPassiveObjectUrlPreview: preview, attachPassiveObjectUrlDownload: download} = api;
  for (const type of ['', 'text/html', 'image/svg+xml', 'text/xml', 'application/javascript', 'text/css', 'application/pdf', 'application/octet-stream', 'text/plain', 'image/png; bad', 'image/png; a="', 'image/png; a=b;', 'image/png, image/jpeg']) window.rejects(() => create(new Blob(['x'], {type})));
  for (const value of [null, {}, 'blob:foreign', new MediaSource()]) window.rejects(() => create(value));
  window.rejects(() => create(new Blob(['x'], {type:'image/png'}), 'script'));
  const handle = create(new Blob(['x'], {type:'IMAGE/PNG; charset="utf-8"'}));
  if (handle.mediaType !== 'image/png' || handle.use !== 'download' || !Object.isFrozen(handle)) throw new Error('metadata');
  const anchor = document.createElement('a');
  for (const forged of [null, {}, handle.url, {...handle}, Object.create(handle), JSON.parse(JSON.stringify(handle)), URL.createObjectURL(new Blob(['x']))]) {
    window.rejects(() => download(anchor, forged, 'test.png'));
    window.rejects(() => revoke(forged));
    if (typeof forged === 'string' && forged.startsWith('blob:')) URL.revokeObjectURL(forged);
  }
  window.rejects(() => navigationUrl(handle.url));
  window.rejects(() => resourceUrl(handle.url));
  window.rejects(() => preview(document.createElement('img'), handle));
  window.rejects(() => download(document.createElement('iframe'), handle, 'x'));
  for (const name of ['', null, 42]) window.rejects(() => download(anchor, handle, name));
  const detach = download(anchor, handle, 'x.png');
  anchor.href = '/replacement'; detach(); detach();
  if (anchor.getAttribute('href') !== '/replacement') throw new Error('overwrote replacement');
  revoke(handle); revoke(handle);
  if (!handle.revoked) throw new Error('state');
  window.rejects(() => download(anchor, handle, 'test.png'));
  const raster = create(new Blob(['x'], {type:'image/png'}), 'raster-preview');
  window.rejects(() => download(anchor, raster, 'x'));
  window.rejects(() => preview(document.createElement('iframe'), raster));
  const img = document.createElement('img');
  const detachPreview = preview(img, raster);
  img.src = '/replacement'; detachPreview(); detachPreview();
  if (img.getAttribute('src') !== '/replacement') throw new Error('overwrote replacement');
  revoke(raster);
  class LyingBlob extends Blob { get type() { return 'image/png'; } }
  window.rejects(() => create(new LyingBlob(['<script>'], {type:'text/html'})));
};
let root;
window.mount = function mount(bytes, type, mode, fail = false, filename = 'picture.png') {
  if (!root) root = createRoot(document.getElementById('root'));
  const Component = mode === 'download' ? api.PassiveObjectUrlDownload : api.PassiveObjectUrlPreview;
  const child = React.createElement(Component, {blob: new Blob([new Uint8Array(bytes)], {type}), alt:'preview', filename}, mode === 'download' ? 'Download' : undefined);
  function Failure() { throw new Error('render failed'); }
  flushSync(() => root.render(React.createElement(StrictMode, null, child, fail ? React.createElement(Failure) : null)));
};
window.unmount = function unmount() { if (root) { flushSync(() => root.unmount()); root = undefined; } };

// mountPreview's defensive catch requires a DOM setter/ref failure in a committed
// native img; supported engines cannot produce that without a test double.
// Native allocation failures likewise require engine resource exhaustion. The
// download attachment failure is reachable with an empty filename and is tested.
