import assert from 'node:assert/strict';
import test from 'node:test';
import { REDACTED, cleanText, redact } from '../src/index.js';

test("sensitive keys are replaced, including the game's own wire names", () => {
  const out = redact({
    token: 'abc',
    sessionId: 'x',
    senha: 'y',
    nick: 'SomeName',
    username: 'u',
    login: 'l',
    email: 'e',
    level: 7,
  }) as Record<string, unknown>;
  for (const key of ['token', 'sessionId', 'senha', 'nick', 'username', 'login', 'email']) assert.equal(out[key], REDACTED, key);
  assert.equal(out.level, 7);
});

test('e-mails and token-looking text are cleaned inside free text', () => {
  assert.equal(cleanText('contact me@example.com now'), 'contact [email] now');
  assert.equal(cleanText(`key ${'A1b2'.repeat(8)} end`), 'key […] end');
  assert.equal(cleanText('ab '.repeat(100), 10), 'ab ab ab a…'); // plain text is only shortened
  assert.equal(cleanText('x'.repeat(300)), '[…]'); // one long run looks like a token
});

test('only text and plain scalars are text; an object is not turned into "[object Object]"', () => {
  assert.equal(cleanText(42), '42');
  assert.equal(cleanText(true), 'true');
  assert.equal(cleanText({ a: 1 }), '');
  assert.equal(cleanText(null), '');
  assert.equal(cleanText(undefined), '');
});

test('arrays and depth are limited, and the input is not mutated', () => {
  const input = { list: [1, 2, 3, 4, 5], deep: { a: { b: { c: { d: { e: 1 } } } } } };
  const copy = JSON.stringify(input);
  const out = redact(input) as { list: unknown[]; deep: unknown };
  assert.deepEqual(out.list, [1, 2, 3, '…+2']);
  assert.match(JSON.stringify(out.deep), /\{…\}/);
  assert.equal(JSON.stringify(input), copy);
});

test('objects with thousands of keys are cut to a count', () => {
  const map = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [String(i), i]));
  const out = redact({ shinyLooks: map }, { maxObjectKeys: 5 }) as { shinyLooks: Record<string, unknown> };
  assert.equal(Object.keys(out.shinyLooks).length, 6);
  assert.equal(out.shinyLooks['(more keys)'], 995);
  assert.equal(Object.keys(redact(map) as Record<string, unknown>).length, 41); // default: 40 keys + the count
});

test('primitives and null pass through', () => {
  assert.equal(redact(5), 5);
  assert.equal(redact(null), null);
  assert.equal(redact(true), true);
});
