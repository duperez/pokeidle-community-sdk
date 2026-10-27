import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseAllFiles } from '../scripts/check-coverage.mjs';
import { applyMutation, testsFailed } from '../scripts/mutation.mjs';
import { MUTATIONS } from '../scripts/mutations.mjs';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '../packages/sdk/src');

test('every listed mutation still applies to the current source (a stale one would prove nothing)', () => {
  for (const mutation of MUTATIONS) {
    const source = fs.readFileSync(path.join(SRC, mutation.file), 'utf8');
    assert.notEqual(applyMutation(source, mutation), null, `${mutation.file}: ${mutation.from}`);
    assert.notEqual(mutation.from, mutation.to);
  }
});

test('testsFailed counts `not ok` lines, not a crashed run', () => {
  assert.equal(testsFailed('ok 1 - a\nnot ok 2 - b\n'), true);
  assert.equal(testsFailed('ok 1 - a\n# pass 1\n'), false);
  assert.equal(testsFailed('Error: cannot find module\n'), false);
});

test('applyMutation replaces only the first occurrence and reports a missing pattern', () => {
  assert.equal(applyMutation('a b a', { from: 'a', to: 'x' }), 'x b a');
  assert.equal(applyMutation('abc', { from: 'zzz', to: 'x' }), null);
});

test('parseAllFiles reads the totals line of the coverage report', () => {
  assert.deepEqual(parseAllFiles('# all files                          |  95.73 |    95.86 |   96.46 |'), {
    lines: 95.73,
    branches: 95.86,
  });
  assert.equal(parseAllFiles('nothing'), null);
});
