import React, {StrictMode} from 'react';
import {createRoot, hydrateRoot} from 'react-dom/client';
import {renderToString} from 'react-dom/server.browser';
import {flushSync} from 'react-dom';
import * as api from 'next-xss-sbyd/object-url';
import {validateUrl} from 'next-xss-sbyd';
import {jsx} from 'next-xss-sbyd/jsx-runtime';
window.api = api;
window.reactVersion = React.version;
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
window.contract = async function contract() {
  const {createPassiveObjectUrl: create, revokePassiveObjectUrl: revoke, attachPassiveObjectUrlPreview: preview, attachPassiveObjectUrlDownload: download} = api;
  for (const type of ['', 'text/html', 'image/svg+xml', 'text/xml', 'application/javascript', 'text/css', 'application/pdf', 'application/octet-stream', 'text/plain', 'image/png; bad', 'image/png; a="', 'image/png; a=b;', 'image/png, image/jpeg']) window.rejects(() => create(new Blob(['x'], {type}), 'download'));
  for (const value of [null, {}, 'blob:foreign', new MediaSource()]) window.rejects(() => create(value, 'download'));
  window.rejects(() => create(new Blob(['x'], {type:'image/png'}), 'script'));
  window.rejects(() => create(new Blob(['x'], {type:'image/png'})));
  const handle = create(new Blob(['x'], {type:'IMAGE/PNG; charset="utf-8"'}), 'download');
  if (handle.mediaType !== 'image/png' || handle.use !== 'download' || !Object.isFrozen(handle)) throw new Error('metadata');
  const anchor = document.createElement('a');
  for (const forged of [null, {}, handle.url, {...handle}, Object.create(handle), JSON.parse(JSON.stringify(handle)), URL.createObjectURL(new Blob(['x']))]) {
    window.rejects(() => download(anchor, forged, 'test.png'));
    window.rejects(() => revoke(forged));
    if (typeof forged === 'string' && forged !== handle.url && forged.startsWith('blob:')) URL.revokeObjectURL(forged);
  }
  window.rejects(() => validateUrl(handle.url));
  window.rejects(() => preview(document.createElement('img'), handle));
  window.rejects(() => download(document.createElement('iframe'), handle, 'x'));
  for (const name of ['', null, 42]) window.rejects(() => download(anchor, handle, name));
  const detach = download(anchor, handle, 'x.png');
  window.rejects(() => download(document.createElement('a'), handle, 'second.png'));
  window.rejects(() => download(anchor, handle, 'second.png'));
  if (await (await fetch(handle.url)).text() !== 'x') throw new Error('second attach broke owner');
  anchor.href = '/replacement'; detach(); detach();
  await new Promise(resolve => setTimeout(resolve, 0));
  if (anchor.getAttribute('href') !== '/replacement') throw new Error('overwrote replacement');
  revoke(handle); revoke(handle);
  if (!handle.revoked) throw new Error('state');
  window.rejects(() => download(anchor, handle, 'test.png'));
  const raster = create(new Blob(['x'], {type:'image/png'}), 'raster-preview');
  window.rejects(() => download(anchor, raster, 'x'));
  window.rejects(() => preview(document.createElement('iframe'), raster));
  const img = document.createElement('img');
  const detachPreview = preview(img, raster);
  window.rejects(() => preview(document.createElement('img'), raster));
  window.rejects(() => preview(img, raster));
  if (await (await fetch(raster.url)).text() !== 'x') throw new Error('second attach broke owner');
  img.src = '/replacement'; detachPreview(); detachPreview();
  if (img.getAttribute('src') !== '/replacement') throw new Error('overwrote replacement');
  revoke(raster);
  class LyingBlob extends Blob { get type() { return 'image/png'; } }
  window.rejects(() => create(new LyingBlob(['<script>'], {type:'text/html'}), 'download'));
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

window.mountDownload = function mountDownload(blob, filename) {
  if (!root) root = createRoot(document.getElementById('root'));
  flushSync(() => root.render(React.createElement(StrictMode, null,
    React.createElement(api.PassiveObjectUrlDownload, {blob, filename}, 'Download'))));
};

let lifecycleBlob;
let lifecycleProps;
function lifecycleElement() {
  const Component = lifecycleProps.mode === 'download' ? api.PassiveObjectUrlDownload : api.PassiveObjectUrlPreview;
  return jsx(StrictMode, {children: jsx(Component, {
    blob: lifecycleBlob, alt: lifecycleProps.alt, filename: lifecycleProps.filename,
    children: lifecycleProps.mode === 'download' ? lifecycleProps.children : undefined,
  })});
}
window.guardRawObjectUrls = function guardRawObjectUrls(url) {
  window.rejects(() => jsx('img', {src: url, alt: 'raw'}));
  window.rejects(() => jsx('a', {href: url, download: 'raw.png', children: 'Raw'}));
};
window.startLifecycle = function startLifecycle(bytes, mode, hydrate = false) {
  window.unmount();
  lifecycleBlob = new Blob([new Uint8Array(bytes)], {type: 'image/png'});
  lifecycleProps = {mode, alt: 'original', filename: 'original.png', children: 'Original'};
  const container = document.getElementById('root');
  if (hydrate) {
    container.innerHTML = renderToString(lifecycleElement());
    if (container.querySelector('[src], [href]')) throw new Error('SSR allocated a resource URL');
    root = hydrateRoot(container, lifecycleElement(), {onRecoverableError(error) { throw error; }});
  } else {
    root = createRoot(container);
    flushSync(() => root.render(lifecycleElement()));
  }
};
window.updateLifecycle = function updateLifecycle(props, bytes) {
  lifecycleProps = {...lifecycleProps, ...props};
  if (bytes) lifecycleBlob = new Blob([new Uint8Array(bytes)], {type: 'image/png'});
  flushSync(() => root.render(lifecycleElement()));
};

class ValidationBoundary extends React.Component {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  componentDidCatch(error) {
    window.validationError = {type: error.name, message: error.message};
  }
  render() { return this.state.failed ? null : this.props.children; }
}
window.invalidFilename = function invalidFilename(filename) {
  window.unmount();
  window.validationError = undefined;
  root = createRoot(document.getElementById('root'));
  flushSync(() => root.render(React.createElement(ValidationBoundary, null,
    React.createElement(api.PassiveObjectUrlDownload, {
      // An invalid Blob makes validation order observable without mocking native APIs.
      blob: {}, filename,
    }, 'Invalid'))));
};

// mountPreview's defensive catch requires a DOM setter/ref failure in a committed
// native img; supported engines cannot produce that without a test double.
// Native allocation failures likewise require engine resource exhaustion. The
// download attachment failure likewise requires a DOM setter/ref failure because
// invalid filenames are rejected during render, before allocation.
