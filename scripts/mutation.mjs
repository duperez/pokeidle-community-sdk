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

/** Did the unit tests fail? Counts `not ok` lines: a crashed run with no test output is NOT a kill. */
export function testsFailed(output) {
  return /^not ok /m.test(output);
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
  const run = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...tests], {
    cwd: path.join(ROOT, 'packages/sdk'),
    encoding: 'utf8',
  });
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
  if (testsFailed(baseline) || !/^# pass \d+/m.test(baseline)) {
    console.error('the tests do not pass without any mutation: fix them first');
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
      const killed = testsFailed(runTests(true));
      fs.writeFileSync(file, original);
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
