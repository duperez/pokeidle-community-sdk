import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyDistribution, verifyHashes } from '../scripts/verify-distribution.mjs';

const bytes = Buffer.from('synthetic distribution fixture\n');
const sha256 = createHash('sha256').update(bytes).digest('hex');
function fixture() {
  return {
    schemaVersion: 1,
    name: 'pokeidle-community-sdk',
    version: '0.0.1',
    revision: 'a'.repeat(40),
    dirty: false,
    lockfileSha256: 'b'.repeat(64),
    files: [{ path: 'dist/index.cjs', size: bytes.length, sha256 }],
  };
}

test('manifest verification accepts matching bytes and rejects changed or missing files', () => {
  const manifest = fixture();
  assert.doesNotThrow(() => verifyHashes(manifest, () => bytes));
  assert.throws(() => verifyHashes(manifest, () => Buffer.from('x')), /size mismatch/);
  assert.throws(() => verifyHashes(manifest, () => Buffer.alloc(bytes.length)), /SHA-256 mismatch/);
  assert.throws(
    () =>
      verifyHashes(manifest, () => {
        throw new Error('missing file');
      }),
    /missing file/,
  );
});

test('manifest verification rejects ambiguous identity, duplicate paths and traversal before reading', () => {
  for (const patch of [{ schemaVersion: 2 }, { name: 'another-package' }, { revision: 'main' }, { dirty: 'false' }, { files: [] }]) {
    assert.throws(() => verifyHashes({ ...fixture(), ...patch }, () => bytes));
  }
  const manifest = fixture();
  manifest.files.push({ ...manifest.files[0] });
  assert.throws(() => verifyHashes(manifest, () => bytes), /duplicate/);
  for (const name of ['../package.json', 'dist/../../secret', '/absolute', 'dist\\index.cjs', 'dist//index.cjs']) {
    const manifest = fixture();
    manifest.files[0].path = name;
    assert.throws(() => verifyHashes(manifest, () => assert.fail('must not read unsafe paths')), /unsafe/);
  }
});

test('archive verification rejects corrupt bytes, invalid integrity and modified checksum lists before installing', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pokeidle-manifest-test-'));
  try {
    const manifest = {
      ...fixture(),
      artifact: {
        file: 'pokeidle-community-sdk-0.0.1.tgz',
        sha256,
        integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
      },
    };
    const save = () => fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
    save();
    fs.writeFileSync(path.join(directory, manifest.artifact.file), Buffer.from('corrupt'));
    assert.throws(() => verifyDistribution(directory), /archive SHA-256 mismatch/);
    fs.writeFileSync(path.join(directory, manifest.artifact.file), bytes);
    const integrity = manifest.artifact.integrity;
    manifest.artifact.integrity = 'sha512-invalid';
    save();
    assert.throws(() => verifyDistribution(directory), /archive npm integrity mismatch/);
    manifest.artifact.integrity = integrity;
    save();
    fs.writeFileSync(path.join(directory, 'SHA256SUMS'), 'modified');
    assert.throws(() => verifyDistribution(directory), /SHA256SUMS mismatch/);
    manifest.version = '../invalid';
    save();
    assert.throws(() => verifyDistribution(directory));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
