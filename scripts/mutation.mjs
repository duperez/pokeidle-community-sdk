#!/usr/bin/env node
// Hand-rolled mutation check for the safety-relevant code: apply ONE change from scripts/mutations.mjs, run the SDK unit
// tests, and demand that they fail. A mutation that is not applied (the code moved on) or that survives (no test notices)
// fails the run. The sources are restored after every mutation, on errors and on Ctrl-C.
//
//   node scripts/mutation.mjs            run them all
//   node scripts/mutation.mjs rate-limiter   only the mutations whose file name contains the text

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPECTED_SURVIVORS, MUTATIONS } from './mutations.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'packages/sdk/src');

// File-wrapper results are not executed tests; this works on every supported Node version.
export default async function* mutationReporter(events) {
  let executed = 0;
  let failed = false;
  let invalid = false;
  for await (const { type, data } of events) {
    if (type === 'test:stdout' || type === 'test:stderr') yield data.message;
    if ((type === 'test:pass' || type === 'test:fail') && !data.skip && !data.todo) {
      const fileWrapper = data.file && path.resolve(data.name) === data.file;
      if (!fileWrapper && data.details.type !== 'suite') executed++;
      if (fileWrapper && type === 'test:fail') invalid = true;
    }
    if (type === 'test:fail' && !data.skip && !data.todo) {
      failed = true;
      const error = data.details.error;
      if (error.exitCode !== undefined || error.signal !== undefined) invalid = true;
      yield `${data.name}: ${error.cause?.stack ?? error.stack ?? error}\n`;
    }
  }
  yield `mutation-result:${invalid || !executed ? 'invalid' : failed ? 'failed' : 'passed'}\n`;
}

export function classifyTestRun(output) {
  return [...output.matchAll(/^mutation-result:(passed|failed|invalid)$/gm)].at(-1)?.[1] ?? 'invalid';
}

export function testsFailed(output) {
  return classifyTestRun(output) === 'failed';
}

export function applyMutation(source, mutation) {
  return source.includes(mutation.from) ? source.replace(mutation.from, mutation.to) : null;
}

function runTests(mutated = false) {
  // Size remains a mandatory baseline gate, not evidence that a semantic mutation was detected.
  const tests = fs
    .readdirSync(path.join(ROOT, 'packages/sdk/test'))
    .filter((name) => name.endsWith('.test.ts') && (!mutated || name !== 'bundle-size.test.ts'))
    .map((name) => path.join('test', name));
  const run = spawnSync(process.execPath, ['--import', 'tsx', '--test', `--test-reporter=${fileURLToPath(import.meta.url)}`, ...tests], {
    cwd: path.join(ROOT, 'packages/sdk'),
    encoding: 'utf8',
  });
  if (run.error) throw run.error;
  if (run.signal) throw new Error(`test runner terminated by ${run.signal}`);
  if (run.status !== 0 && run.status !== 1) throw new Error(`test runner exited with status ${run.status}\n${run.stderr}`);
  return `${run.stdout}\n${run.stderr}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const only = process.argv[2];
  const selected = MUTATIONS.filter((m) => !only || m.file.includes(only));
  const originals = new Map();
  const restore = () => {
    for (const [file, text] of originals) fs.writeFileSync(file, text);
  };
  process.on('SIGINT', () => {
    restore();
    process.exit(130);
  });

  const baseline = runTests();
  if (classifyTestRun(baseline) !== 'passed') {
    console.error('the tests do not pass without any mutation: fix them first\n', baseline);
    process.exit(1);
  }

  const problems = [];
  try {
    for (const mutation of selected) {
      const file = path.join(SRC, mutation.file);
      const original = fs.readFileSync(file, 'utf8');
      originals.set(file, original);
      const mutated = applyMutation(original, mutation);
      if (mutated === null) {
        problems.push(`NOT APPLIED  ${mutation.file}: ${JSON.stringify(mutation.from.slice(0, 60))}`);
        continue;
      }
      fs.writeFileSync(file, mutated);
      const output = runTests(true);
      const result = classifyTestRun(output);
      fs.writeFileSync(file, original);
      if (result === 'invalid') {
        problems.push(`INVALID RUN  ${mutation.file}: ${JSON.stringify(mutation.from.slice(0, 60))}`);
        console.error('invalid test run (not a semantic kill):\n', output);
        continue;
      }
      const killed = result === 'failed';
      const expected = EXPECTED_SURVIVORS.some((s) => s.file === mutation.file && s.from === mutation.from);
      console.log(
        `${killed ? 'killed  ' : expected ? 'expected' : 'SURVIVED'}  ${mutation.file}: ${mutation.from.slice(0, 60).replace(/\n/g, '\\n')}`,
      );
      if (!killed && !expected) problems.push(`SURVIVED     ${mutation.file}: ${JSON.stringify(mutation.from.slice(0, 60))}`);
    }
  } finally {
    restore();
  }
  console.log(`\n${selected.length} mutations, ${problems.length} problem(s)`);
  for (const p of problems) console.error(p);
  process.exit(problems.length ? 1 : 0);
}
