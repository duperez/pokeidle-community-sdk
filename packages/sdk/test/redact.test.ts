import assert from 'node:assert/strict';
import test from 'node:test';
import { REDACTED, cleanText, redact } from '../src/index.js';

test('sensitive keys are replaced, including the game\'s own wire names', () => {
  const out = redact({ token: 'abc', sessionId: 'x', senha: 'y', nick: 'SomeName', username: 'u', login: 'l', email: 'e', level: 7 }) as Record<string, unknown>;
  for (const key of ['token', 'sessionId', 'senha', 'nick', 'username', 'login', 'email']) assert.equal(out[key], REDACTED, key);
  assert.equal(out.level, 7);
});

test('e-mails and token-looking text are cleaned inside free text', () => {
  assert.equal(cleanText('contact me@example.com now'), 'contact [email] now');
  assert.equal(cleanText(`key ${'A1b2'.repeat(8)} end`), 'key […] end');
  assert.equal(cleanText('ab '.repeat(100), 10), 'ab ab ab a…'); // plain text is only shortened
  assert.equal(cleanText('x'.repeat(300)), '[…]'); // one long run looks like a token
});

test('arrays and depth are limited, and the input is not mutated', () => {
  const input = { list: [1, 2, 3, 4, 5], deep: { a: { b: { c: { d: { e: 1 } } } } } };
  const copy = JSON.stringify(input);
  const out = redact(input) as { list: unknown[]; deep: unknown };
  assert.deepEqual(out.list, [1, 2, 3, '…+2']);
  assert.match(JSON.stringify(out.deep), /\{…\}/);
  assert.equal(JSON.stringify(input), copy);
});

test('primitives and null pass through', () => {
  assert.equal(redact(5), 5);
  assert.equal(redact(null), null);
  assert.equal(redact(true), true);
});
