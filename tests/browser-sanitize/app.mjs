import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import DOMPurify from 'dompurify';
import {SafeBlock} from 'next-xss-sbyd';
import {sanitizeUserHtml} from 'next-xss-sbyd/sanitize';

const root = createRoot(document.getElementById('root'));
let clean;
window.sanitizeHarness = {
  sanitize(dirty) { clean = sanitizeUserHtml(dirty); },
  display() { flushSync(() => root.render(React.createElement(SafeBlock, {html: clean}))); },
  contract() {
    for (const args of [[null], [42], [{}], ['safe', {}]]) {
      let rejected = false;
      try { sanitizeUserHtml(...args); } catch { rejected = true; }
      if (!rejected) throw new Error('invalid call accepted');
    }
    const value = sanitizeUserHtml('<b>authentic</b>');
    for (const html of ['<b>raw</b>', {...value}, JSON.parse(JSON.stringify(value))]) {
      let rejected = false;
      try { SafeBlock({html}); } catch { rejected = true; }
      if (!rejected) throw new Error('unauthenticated SafeHtml accepted');
    }
  },
  poisonApplicationPurifier() {
    DOMPurify.setConfig({ADD_TAGS: ['iframe'], RETURN_DOM: true});
    DOMPurify.addHook('afterSanitizeAttributes', node => node.setAttribute?.('onclick', 'window.attacked=true'));
  },
  timing() {
    const dirty = '<section><p aria-label="Warning: hot">Long article <mark>highlight</mark><a href="/read">read</a></p></section>'.repeat(2000);
    const durations = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      sanitizeUserHtml(dirty);
      durations.push(performance.now() - start);
    }
    return {inputBytes: new TextEncoder().encode(dirty).length, milliseconds: durations};
  },
};
