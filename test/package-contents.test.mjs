import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// What would be published: only the built library plus the package metadata, nothing else (no sources, tests, scripts,
// source maps pointing into this machine, or local files). Needs `npm run build` first, as CI does.

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = existsSync(path.join(ROOT, 'packages/sdk/dist/index.js'));

test('npm pack contains the built library and nothing it should not', { skip: built ? false : 'run `npm run build` first' }, () => {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '-w', 'pokeidle-community-sdk'], { cwd: ROOT, encoding: 'utf8' });
  const [pack] = JSON.parse(out);
  const files = pack.files.map((f) => f.path);
  for (const required of [
    'package.json',
    'LICENSE',
    'README.md',
    'dist/index.js',
    'dist/index.d.ts',
    'dist/index.cjs',
    'dist/cjs/index.d.ts',
    'dist/cjs/package.json',
  ])
    assert.ok(files.includes(required), `missing ${required}`);
  const allowed = (f) => f === 'package.json' || f === 'LICENSE' || f === 'README.md' || f.startsWith('dist/');
  assert.deepEqual(
    files.filter((f) => !allowed(f)),
    [],
  );
  assert.equal(
    files.some((f) => f.endsWith('.test.js') || f.includes('/test/')),
    false,
  );
});

test('the published package metadata is complete and has no personal data', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'packages/sdk/package.json'), 'utf8'));
  for (const field of ['name', 'version', 'description', 'license', 'repository', 'bugs', 'homepage', 'keywords', 'engines', 'exports'])
    assert.ok(pkg[field], `package.json has no ${field}`);
  assert.equal(pkg.author, undefined);
  assert.equal(pkg.sideEffects, false);
});
