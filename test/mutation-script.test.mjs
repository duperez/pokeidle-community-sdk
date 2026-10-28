import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseAllFiles } from '../scripts/check-coverage.mjs';
import { applyMutation, classifyTestRun, testsFailed } from '../scripts/mutation.mjs';
import { MUTATIONS } from '../scripts/mutations.mjs';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '../packages/sdk/src');

test('every listed mutation still applies to the current source (a stale one would prove nothing)', () => {
  for (const mutation of MUTATIONS) {
    const source = fs.readFileSync(path.join(SRC, mutation.file), 'utf8');
    assert.notEqual(applyMutation(source, mutation), null, `${mutation.file}: ${mutation.from}`);
    assert.notEqual(mutation.from, mutation.to);
  }
});

test('mutation classification rejects missing or incomplete reporter output', () => {
  for (const output of ['', 'ok 1 - a\nnot ok 2 - b\n', 'Error: cannot find module\n']) {
    assert.equal(classifyTestRun(output), 'invalid');
    assert.equal(testsFailed(output), false);
  }
});

test('the real Node runner distinguishes semantic failures from import, syntax and no-test runs', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-mutation-classification-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const reporter = fileURLToPath(new URL('../scripts/mutation.mjs', import.meta.url));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const prelude = "import test from 'node:test'; import assert from 'node:assert/strict';\n";
  const fixtures = [
    ['passing', `${prelude}test('passes', () => assert.equal(1, 1));`, 'passed', 0],
    ['assertion', `${prelude}test('fails', () => assert.equal(1, 2));`, 'failed', 1],
    ['runtime-error', `${prelude}test('fails', () => { throw new TypeError('regression'); });`, 'failed', 1],
    ['missing-import', "import './__missing_review_module__.mjs';", 'invalid', 1],
    ['syntax', `${prelude}test('never executes', () => {`, 'invalid', 1],
    ['empty', '', 'invalid', 0],
    ['no-tests', prelude, 'invalid', 0],
    ['skipped', `${prelude}test.skip('does not execute', () => assert.fail());`, 'invalid', 0],
    ['crash', 'process.exit(2);', 'invalid', 1],
  ];
  for (const [name, source, expected, status] of fixtures) {
    const file = path.join(directory, `${name}.mjs`);
    fs.writeFileSync(file, source);
    const run = spawnSync(process.execPath, ['--test', `--test-reporter=${reporter}`, file], { encoding: 'utf8', env });
    assert.ifError(run.error);
    assert.equal(run.status, status, `${name}: ${run.stderr}`);
    const output = `${run.stdout}\n${run.stderr}`;
    assert.equal(classifyTestRun(output), expected, `${name}: ${output}`);
    assert.equal(testsFailed(output), expected === 'failed', name);
  }
  for (const invalid of ['missing-import', 'syntax', 'crash']) {
    const files = ['passing', 'assertion', invalid].map((name) => path.join(directory, `${name}.mjs`));
    const run = spawnSync(process.execPath, ['--test', `--test-reporter=${reporter}`, ...files], { encoding: 'utf8', env });
    assert.ifError(run.error);
    assert.equal(run.status, 1);
    assert.equal(classifyTestRun(`${run.stdout}\n${run.stderr}`), 'invalid', `mixed run: ${invalid}`);
  }
  const typescript = path.join(directory, 'compile.ts');
  fs.writeFileSync(typescript, 'export const broken: = 1;');
  const compile = spawnSync(process.execPath, ['--import', 'tsx', '--test', `--test-reporter=${reporter}`, typescript], {
    encoding: 'utf8',
    env,
  });
  assert.ifError(compile.error);
  assert.equal(compile.status, 1);
  assert.match(compile.stdout, /TransformError/);
  assert.equal(classifyTestRun(`${compile.stdout}\n${compile.stderr}`), 'invalid');
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
