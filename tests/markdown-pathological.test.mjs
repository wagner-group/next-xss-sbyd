import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

// Real public-component SSR in a killable process: a parser regression cannot
// pin the test runner forever. Timings exclude process startup and imports.
// Cases adapted from CommonMark cmark's test/pathological_tests.py and PR #40.
// The C-specific reference hash collision generator is inapplicable to JS Maps;
// reference pressure is covered by repeated definitions instead.
test('pathological CommonMark rejects or renders each case within 500ms', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import {createElement} from 'react';
    import {renderToStaticMarkup} from 'react-dom/server';
    import {SafeMarkdown} from 'next-xss-sbyd/markdown';
    const cases = [
      ['blockquote', '> ', 100000], ['list', '- ', 60000],
      ['emphasis', '_*', 131072], ['code emphasis', '*\u0060a\u0060*', 52000],
      ['strong emphasis', '*a **a ', 32500], ['emphasis closer', 'a_ ', 32500],
      ['emphasis opener', '_a ', 32500], ['link closer', 'a]', 32500],
      ['link opener', '[a', 32500], ['mismatch', '*a_ ', 25000],
      ['link/emphasis', '[ a_', 25000], ['unclosed destination', '[ (](', 40000],
      ['image', '![[]()', 160000], ['unclosed angle link', '[a](<b', 30000],
      ['unclosed link', '[a](b', 30000], ['unclosed HTML', '<!--', 300000],
      ['references', '[ref]: /url\\n\\n[ref]\\n\\n', 40000],
    ];
    const inputs = cases.flatMap(([name, pattern, count]) => [
      [name, pattern.repeat(count), true],
      [name + ' within byte limit', pattern.repeat(Math.floor(32768 / pattern.length)), true],
      [name + ' small', pattern.repeat(Math.floor(240 / pattern.length)), false],
    ]);
    inputs.push(
      ['nested brackets', '['.repeat(130000) + ']'.repeat(130000), true],
      ['brackets within byte limit', '['.repeat(16000) + ']'.repeat(16000), true],
      ['brackets at syntax limit', '['.repeat(512) + ']'.repeat(512), false],
      ['code runs', Array.from({length: 100}, (_, i) => 'e' + '\u0060'.repeat(i)).join(''), true],
      ['indented lists', Array.from({length: 150}, (_, i) => '  '.repeat(i) + '* a\\n').join(''), true],
      ['list blank lines', '- '.repeat(4000) + 'x' + '\\n'.repeat(4000), true],
      ['mixed containers', '> ' + '- '.repeat(4000) + 'x\\n' + '>\\n'.repeat(4000), true],
      ['issue 389', '*a '.repeat(2000) + '_a*_ '.repeat(2000), true],
      ['multiple-of-three emphasis', 'a**b' + 'c* '.repeat(8000), true],
      ['hard link/emphasis', '**x [a*b**c*](d)', false],
      ['null characters', 'abc\\0de\\0', false],
      ['maximum ordinary text', 'a'.repeat(32768), false],
    );
    let maximum = 0;
    for (const [name, source, reject] of inputs) {
      const start = performance.now();
      const render = () => renderToStaticMarkup(createElement(SafeMarkdown, {children: source}));
      if (reject) assert.throws(render, RangeError, name);
      else { try { render(); } catch (error) { if (!(error instanceof RangeError)) throw error; } }
      const elapsed = performance.now() - start;
      assert.ok(elapsed < 500, name + ': ' + elapsed + 'ms');
      maximum = Math.max(maximum, elapsed);
    }
    console.log(inputs.length + ' pathological/scaled cases; max ' + maximum.toFixed(1) + 'ms');
  `], {encoding: 'utf8', timeout: 30000});
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr);
  console.log(result.stdout.trim());
});
