import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {JSDOM} from 'jsdom';
import {SafeMarkdown} from 'next-xss-sbyd/markdown';
import {SafeBlock} from 'next-xss-sbyd';
import {sanitizeUserHtml} from 'next-xss-sbyd/sanitize';

/** Render the public component through the real React server renderer. */
function render(children, extra = {}) {
  return renderToStaticMarkup(createElement(SafeMarkdown, {children, ...extra}));
}

/** Parse actual serialized markup for observable DOM assertions. */
function documentFor(source) {
  return new JSDOM(render(source)).window.document;
}

test('SafeMarkdown renders CommonMark formatting and only approved attributes', () => {
  const document = documentFor('# Heading\n\n**strong** and *emphasis* with `code`\n\n> quotation\n\n---\n\n3. third\n4. fourth\n\n- bullet\n\n```js\n<script>literal</script>\n```');
  assert.equal(document.querySelector('h1').textContent, 'Heading');
  assert.equal(document.querySelector('strong').textContent, 'strong');
  assert.equal(document.querySelector('em').textContent, 'emphasis');
  assert.equal(document.querySelector('blockquote p').textContent, 'quotation');
  assert.equal(document.querySelectorAll('hr').length, 1);
  assert.equal(document.querySelector('ol').getAttribute('start'), '3');
  assert.equal(document.querySelectorAll('li').length, 3);
  assert.equal(document.querySelector('pre code').textContent, '<script>literal</script>\n');
  assert.equal(document.querySelector('[class], [id], [style], script'), null);
  assert.equal(render(''), '');
  assert.match(render('1. one'), /<ol>/);
  assert.match(render('0. zero'), /start="0"/);
  assert.match(render('999999999. last'), /start="999999999"/);
});

test('SafeMarkdown validates parsed passive URLs and preserves useful fallback text', () => {
  const document = documentFor('[root](/docs "title") [secure](https://example.com) [mail](mailto:a@example.com) [phone](tel:+123) ![safe](/pixel.png "photo")');
  assert.deepEqual([...document.querySelectorAll('a')].map(a => a.getAttribute('href')), ['/docs', 'https://example.com/', 'mailto:a@example.com', 'tel:+123']);
  for (const a of document.querySelectorAll('a')) assert.equal(a.rel, 'nofollow noopener noreferrer');
  assert.equal(document.querySelector('a').title, 'title');
  const image = document.querySelector('img');
  assert.equal(image.getAttribute('src'), '/pixel.png');
  assert.equal(image.getAttribute('referrerpolicy'), 'no-referrer');
  assert.equal(image.alt, 'safe');
  assert.equal(image.title, 'photo');
  for (const url of ['javascript:alert%281%29', 'JaVaScRiPt:alert%281%29', 'jav&#x61;script:alert%281%29', 'java&#x09;script:alert%281%29', 'data:text/html,evil', 'blob:https://example.com/id', '//example.com/path', '#heading', './page', 'image.png', 'https://user:pass@example.com']) {
    const unsafe = documentFor(`[**readable**](${url}) ![fallback](${url})`);
    assert.equal(unsafe.querySelector('a, img'), null, url);
    assert.equal(unsafe.querySelector('strong').textContent, 'readable', url);
    assert.match(unsafe.body.textContent, /fallback/, url);
  }
  for (const [url, expected] of [
    ['/a/../image.png', '/image.png'],
    ['https://Example.COM:443/image.png', 'https://example.com/image.png'],
    ['http://example.com/image.png', 'http://example.com/image.png'],
    ['mailto:a@example.com', 'mailto:a@example.com'],
    ['tel:+123', 'tel:+123'],
  ]) {
    const accepted = documentFor(`[link](${url}) ![image](${url})`);
    assert.equal(accepted.querySelector('a').getAttribute('href'), expected, url);
    assert.equal(accepted.querySelector('img').getAttribute('src'), expected, url);
  }
  for (const url of ['mailto:', 'mailto:a%0Ab@example.com', 'tel:abc', 'tel:+123%0A']) {
    const rejected = documentFor(`[link](${url}) ![fallback](${url})`);
    assert.equal(rejected.querySelector('a, img'), null, url);
    assert.match(rejected.body.textContent, /link.*fallback/, url);
  }
});

test('SafeMarkdown ignores raw HTML and treats MDX as data', () => {
  const source = '<script>globalThis.__markdownAttack = 1</script>\n\n<img src="/attack" onerror="globalThis.__markdownAttack = 1">\n\n<svg onload="globalThis.__markdownAttack = 1"><a href="javascript:alert(1)">x</a></svg>\n\n<math><mtext><img src=x onerror=alert(1)></mtext></math>\n\n<a id="location" name="document" target="_blank" onclick="alert(1)">kept text</a>\n\n{globalThis.__markdownAttack = 1}\n\nimport Something from "evil"\n\n**Still readable**';
  const document = documentFor(source);
  assert.equal(document.querySelector('script,img,svg,math,a,[id],[name],[onclick],iframe,form'), null);
  assert.match(document.body.textContent, /kept text/);
  assert.match(document.body.textContent, /\{globalThis.__markdownAttack = 1\}/);
  assert.equal(document.querySelector('strong').textContent, 'Still readable');
  assert.equal(globalThis.__markdownAttack, undefined);
  assert.doesNotThrow(() => render('> - **nested\n\n<div><p></div></p>\n\n[broken](<javascript:alert(1)>)'));
});

test('SafeMarkdown rejects configuration overrides and non-string source before parsing', () => {
  for (const value of [undefined, null, 0, false, [], {}, new String('text')]) {
    assert.throws(() => render(value), /SafeMarkdown requires a string/);
  }
  for (const name of ['remarkPlugins', 'rehypePlugins', 'components', 'urlTransform', 'skipHtml', 'className', 'dangerouslySetInnerHTML', 'trusted', 'unsafe', 'ref']) {
    assert.throws(() => render('source', {[name]: false}), /Unsupported SafeMarkdown prop/, name);
  }
});

test('SafeMarkdown bounds UTF-8 input and syntax before parsing', () => {
  assert.doesNotThrow(() => render('a'.repeat(32768)));
  assert.doesNotThrow(() => render('😀'.repeat(8192)));
  assert.throws(() => render('a'.repeat(32769)), /SafeMarkdown.*32 KiB/);
  assert.throws(() => render('😀'.repeat(8193)), /SafeMarkdown.*32 KiB/);
  assert.doesNotThrow(() => render('!'.repeat(1024)));
  assert.throws(() => render('!'.repeat(1025)), /SafeMarkdown.*1,024/);
  assert.throws(() => render('> '.repeat(129) + 'deep'), /SafeMarkdown.*128/);
  assert.throws(() => render('- '.repeat(129) + 'deep'), /SafeMarkdown.*128/);
  assert.throws(() => render('1. '.repeat(129) + 'deep'), /SafeMarkdown.*128/);
  assert.throws(() => render(' '.repeat(129) + 'code'), /SafeMarkdown.*indentation/);
  assert.throws(() => render('\t'.repeat(33) + 'code'), /SafeMarkdown.*indentation/);
  assert.doesNotThrow(() => render('> '.repeat(120) + 'readable'));
  assert.doesNotThrow(() => render(' '.repeat(128) + 'code'));
  assert.doesNotThrow(() => render('\t'.repeat(32) + 'code'));
  assert.doesNotThrow(() => render('-\n+\n*\n1.\n2)\n3) item'));
  assert.doesNotThrow(() => render('1234567890. text\r\n+ bullet\n* item\n- item'));
  assert.throws(() => render(Array.from({length: 150}, (_, i) => '  '.repeat(i) + '* a\n').join('')), /SafeMarkdown.*indentation/);
  assert.doesNotThrow(() => render('x\n\n'.repeat(10000)));
  // The 50,000-node backstops cannot be reached through the smaller input/syntax
  // budgets with this closed parser profile; exercising them requires synthetic
  // trees, which would not test the public rendering behavior.
  // Tree depth remains a separate guard: list nesting creates both list/item nodes.
  assert.throws(() => render('- '.repeat(70) + 'deep'), /SafeMarkdown.*128/);
});

test('HTML migration sanitizes the final output including plugin-generated markup', async () => {
  // Real HTML parser output plus a downstream transformation; the final sanitizer
  // is the boundary even if a parser/plugin accepts unsafe source or emits HTML.
  const rendered = render('**article**');
  const transformed = rendered + '<img src="/pixel.png" onerror="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">bad link</a>';
  const html = renderToStaticMarkup(createElement(SafeBlock, {html: sanitizeUserHtml(transformed)}));
  const document = new JSDOM(html).window.document;
  assert.equal(document.querySelector('strong').textContent, 'article');
  assert.equal(document.querySelector('img').getAttribute('src'), '/pixel.png');
  assert.equal(document.querySelector('script,[onerror],a[href]'), null);
});
