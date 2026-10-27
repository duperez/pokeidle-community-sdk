#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sdk = new URL('../packages/sdk/', import.meta.url);

// TypeScript does not remove outputs belonging to deleted or renamed source files.
fs.rmSync(new URL('dist/', sdk), { recursive: true, force: true });
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.build.json'], {
  cwd: sdk,
  stdio: 'inherit',
});
await import('./build-bundles.mjs');
