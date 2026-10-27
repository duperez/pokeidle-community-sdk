#!/usr/bin/env node
// Runs the SDK unit tests with coverage and fails if it falls under the floor. The floor sits a little under today's
// numbers (95.7% lines, 95.9% branches): it stops the slide, it is not a target. Raise it when coverage rises.
//
//   node scripts/check-coverage.mjs

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FLOOR = { lines: 94, branches: 92 };

export function parseAllFiles(report) {
  const match = /all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/.exec(report);
  return match ? { lines: Number(match[1]), branches: Number(match[2]) } : null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const run = spawnSync('npm', ['run', 'test:coverage', '-w', 'pokeidle-community-sdk'], { cwd: ROOT, encoding: 'utf8' });
  const output = `${run.stdout}\n${run.stderr}`;
  if (run.status !== 0) {
    console.error(output);
    console.error('the tests failed, so coverage was not checked');
    process.exit(1);
  }
  const found = parseAllFiles(output);
  if (!found) {
    console.error(output);
    console.error('could not find the "all files" line of the coverage report');
    process.exit(1);
  }
  console.log(`coverage: lines ${found.lines}% (floor ${FLOOR.lines}), branches ${found.branches}% (floor ${FLOOR.branches})`);
  if (found.lines < FLOOR.lines || found.branches < FLOOR.branches) {
    console.error('coverage is under the floor: add tests for what you changed');
    process.exit(1);
  }
}
