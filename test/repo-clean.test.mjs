// This repository is public: nothing personal, no credentials, no binaries and no dumps of account data may be tracked.
// The test looks at the files git tracks (what would be pushed) and fails if something of the kind shows up.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWED_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.json', '.md', '.yml', '']);
const MAX_FILE_BYTES = 200_000;
const MAX_JSON_BYTES = 40_000; // a bigger JSON looks like a data dump
const THIS_FILE = 'test/repo-clean.test.mjs';
const LOCK_FILES = new Set(['package-lock.json']);

let files = null;
try {
  files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
} catch {
  /* not a git checkout (for example a source archive): skip */
}
const options = { skip: files ? false : 'git is not available' };

// Built from pieces so this file does not match itself.
const PERSONAL_PATH = new RegExp(`(/${'Users'}/|/${'home'}/|[A-Z]:\\\\${'Users'}\\\\)[A-Za-z0-9._-]+`);
const SECRETS = [
  [new RegExp(`client_${'secret'}["']?\\s*[:=]\\s*["'][^"']{8,}`, 'i'), 'client secret'],
  [new RegExp(`(access|refresh)_${'token'}["']?\\s*[:=]\\s*["'][A-Za-z0-9._-]{20,}`, 'i'), 'access token'],
  [new RegExp(`-----BEGIN [A-Z ]*PRIVATE ${'KEY'}`), 'private key'],
  [/AKIA[0-9A-Z]{16}/, 'AWS key'],
  [/\bBearer [A-Za-z0-9._-]{30,}/, 'Bearer header'],
];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const EMAIL_OK = /@(users\.noreply\.github\.com|example\.(com|org)|localhost)$/i;

test('only code and documentation file types, and no big files', options, () => {
  for (const file of files) {
    assert.ok(ALLOWED_EXTENSIONS.has(path.extname(file)), `${file}: file type not allowed (images, binaries and data do not belong here)`);
    const size = fs.statSync(path.join(ROOT, file)).size;
    assert.ok(size <= MAX_FILE_BYTES, `${file}: ${size} bytes, too big`);
    if (file.endsWith('.json') && !LOCK_FILES.has(path.basename(file)))
      assert.ok(size <= MAX_JSON_BYTES, `${file}: JSON too big (looks like a data dump)`);
  }
});

test('no personal paths, credentials or e-mail addresses in tracked files', options, () => {
  for (const file of files) {
    if (file === THIS_FILE || LOCK_FILES.has(path.basename(file))) continue;
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.ok(!PERSONAL_PATH.test(text), `${file}: contains a user path`);
    for (const [re, name] of SECRETS) assert.ok(!re.test(text), `${file}: looks like it contains a ${name}`);
    for (const email of text.match(EMAIL) ?? []) assert.ok(EMAIL_OK.test(email), `${file}: e-mail address ${email}`);
  }
});

test('the things that must stay out of the repository are in .gitignore', () => {
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  for (const item of ['node_modules/', 'dist/', '.env', 'recordings/']) assert.ok(ignore.includes(item), `.gitignore is missing ${item}`);
});
