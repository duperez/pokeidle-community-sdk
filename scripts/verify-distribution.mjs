#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNpm } from './npm.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function verifyHashes(manifest, readFile) {
  assert.equal(manifest.schemaVersion, 1, 'unsupported distribution manifest');
  assert.equal(manifest.name, 'pokeidle-community-sdk');
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.match(manifest.revision, /^[a-f0-9]{40}$/);
  assert.equal(typeof manifest.dirty, 'boolean');
  assert.match(manifest.lockfileSha256, /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0, 'missing package files');
  const paths = new Set();
  for (const file of manifest.files) {
    assert.ok(
      /^(?:package\.json|LICENSE|README\.md|dist\/[A-Za-z0-9_./-]+)$/.test(file.path) &&
        !file.path.split('/').some((part) => part === '.' || part === '..' || part === ''),
      `unsafe or unexpected package path: ${file.path}`,
    );
    assert.ok(!paths.has(file.path), `duplicate package path: ${file.path}`);
    paths.add(file.path);
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(file.size) && file.size >= 0, `invalid size: ${file.path}`);
    const bytes = readFile(file.path);
    assert.equal(bytes.length, file.size, `size mismatch: ${file.path}`);
    assert.equal(sha256(bytes), file.sha256, `SHA-256 mismatch: ${file.path}`);
  }
}

export function verifyDistribution(directory) {
  const manifestBytes = fs.readFileSync(path.join(directory, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.equal(manifest.artifact.file, `pokeidle-community-sdk-${manifest.version}.tgz`);
  assert.match(manifest.artifact.sha256, /^[a-f0-9]{64}$/);
  const archive = path.join(directory, manifest.artifact.file);
  const archiveBytes = fs.readFileSync(archive);
  assert.equal(sha256(archiveBytes), manifest.artifact.sha256, 'archive SHA-256 mismatch');
  assert.equal(
    `sha512-${createHash('sha512').update(archiveBytes).digest('base64')}`,
    manifest.artifact.integrity,
    'archive npm integrity mismatch',
  );
  assert.equal(
    fs.readFileSync(path.join(directory, 'SHA256SUMS'), 'utf8'),
    `${manifest.artifact.sha256}  ${manifest.artifact.file}\n${sha256(manifestBytes)}  manifest.json\n`,
    'SHA256SUMS mismatch',
  );
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pokeidle-sdk-verify-'));
  try {
    runNpm(['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', '--prefix', temporary, archive], {
      cwd: temporary,
    });
    const installed = path.join(temporary, 'node_modules', 'pokeidle-community-sdk');
    verifyHashes(manifest, (name) => fs.readFileSync(path.join(installed, name)));
    const pkg = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'));
    assert.equal(pkg.version, manifest.version, 'package version differs from manifest');
    const files = [];
    function walk(directory, relative = '') {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const name = relative + entry.name;
        if (entry.isDirectory()) walk(path.join(directory, entry.name), name + '/');
        else {
          assert.ok(entry.isFile(), `unexpected installed entry: ${name}`);
          files.push(name);
        }
      }
    }
    walk(installed);
    assert.deepEqual(files.sort(), manifest.files.map((file) => file.path).sort(), 'archive contains unlisted files');
    return manifest;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = fileURLToPath(new URL('../artifacts/sdk/', import.meta.url));
  const manifest = verifyDistribution(directory);
  process.stdout.write(`Verified archive and all package files: ${manifest.name}@${manifest.version} (${manifest.revision})\n`);
}
