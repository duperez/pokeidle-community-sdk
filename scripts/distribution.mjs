#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNpm } from './npm.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sdk = path.join(root, 'packages/sdk');
const output = path.join(root, 'artifacts/sdk');
const args = process.argv.slice(2);
assert.ok(
  args.every((arg) => arg === '--require-clean'),
  'usage: npm run distribution -- [--require-clean]',
);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const revision = git('rev-parse', 'HEAD');
const dirty = git('status', '--porcelain', '--untracked-files=all') !== '';
assert.match(revision, /^[a-f0-9]{40}$/);
if (args.includes('--require-clean')) assert.equal(dirty, false, 'distribution requires a clean checkout');
if (dirty) process.stderr.write('Warning: local distribution includes uncommitted changes (manifest dirty=true).\n');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const lockfileSha256 = sha256(fs.readFileSync(path.join(root, 'package-lock.json')));
const pkg = JSON.parse(fs.readFileSync(path.join(sdk, 'package.json'), 'utf8'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pokeidle-sdk-distribution-'));

function pack(directory) {
  runNpm(['run', 'build', '-w', pkg.name], { cwd: root, stdio: 'inherit' });
  fs.mkdirSync(directory);
  const [packed] = JSON.parse(
    runNpm(['pack', '--json', '--ignore-scripts', '--pack-destination', directory, '-w', pkg.name], { cwd: root }),
  );
  const files = packed.files
    .map(({ path: name }) => {
      assert.ok(['package.json', 'LICENSE', 'README.md'].includes(name) || name.startsWith('dist/'), `unexpected package file: ${name}`);
      const bytes = fs.readFileSync(path.join(sdk, name));
      return { path: name, size: bytes.length, sha256: sha256(bytes) };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const required of [
    'dist/index.js',
    'dist/index.d.ts',
    'dist/index.cjs',
    'dist/cjs/index.d.ts',
    'dist/cjs/package.json',
    'dist/pokeidle-sdk.iife.js',
  ]) {
    assert.ok(
      files.some((file) => file.path === required),
      `missing distribution entry: ${required}`,
    );
  }
  const archive = fs.readFileSync(path.join(directory, packed.filename));
  return { packed, files, archive };
}

try {
  const first = pack(path.join(temporary, 'first'));
  const second = pack(path.join(temporary, 'second'));
  assert.deepEqual(second.files, first.files, 'two clean SDK builds produced different files');
  assert.equal(sha256(second.archive), sha256(first.archive), 'two npm packs produced different archives');
  assert.equal(git('rev-parse', 'HEAD'), revision, 'revision changed during distribution');
  if (!dirty) assert.equal(git('status', '--porcelain', '--untracked-files=all'), '', 'checkout changed during distribution');
  assert.equal(sha256(fs.readFileSync(path.join(root, 'package-lock.json'))), lockfileSha256, 'lockfile changed during distribution');
  const requireTool = (name) => JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
  const manifest = {
    schemaVersion: 1,
    name: pkg.name,
    version: pkg.version,
    revision,
    dirty,
    toolchain: {
      node: process.version,
      npm: runNpm(['--version'], { cwd: root }).trim(),
      typescript: requireTool('typescript'),
      esbuild: requireTool('esbuild'),
      platform: process.platform,
      arch: process.arch,
    },
    lockfileSha256,
    compatibility: { node: pkg.engines.node, ecmaTarget: 'ES2022', formats: ['esm', 'cjs', 'iife'] },
    artifact: {
      file: first.packed.filename,
      sha256: sha256(first.archive),
      integrity: first.packed.integrity,
    },
    files: first.files,
  };
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, manifest.artifact.file), first.archive);
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(
    path.join(output, 'SHA256SUMS'),
    `${manifest.artifact.sha256}  ${manifest.artifact.file}\n${sha256(fs.readFileSync(path.join(output, 'manifest.json')))}  manifest.json\n`,
  );
  process.stdout.write(`Reproducible SDK distribution: artifacts/sdk/ (${revision}, dirty=${dirty})\n`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
