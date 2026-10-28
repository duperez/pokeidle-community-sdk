import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defaultErrorHandler, guarded } from '../src/errors.js';
import { GameState } from '../src/index.js';
import { PageTransport, type PageLike } from '../src/page-transport.js';
import { PokeIdleClient } from '../src/client-core.js';
import { welcome } from './helpers/fixtures.js';

test('guarded sends a throw to the handler and returns normally', () => {
  const seen: unknown[] = [];
  const boom = new Error('boom');
  guarded(
    (e) => seen.push(e),
    () => {
      throw boom;
    },
  );
  assert.deepEqual(seen, [boom]);
});

test('the default handler logs through console.error, once', () => {
  const spy = mock.method(console, 'error', () => undefined);
  try {
    const err = new Error('x');
    defaultErrorHandler(err);
    assert.equal(spy.mock.callCount(), 1);
    assert.equal(spy.mock.calls[0]?.arguments[1], err);
  } finally {
    spy.mock.restore();
  }
});

test('a state listener that throws reaches the state onError and does not stop the others', () => {
  const errors: unknown[] = [];
  const state = new GameState({ onError: (e) => errors.push(e) });
  let reached = false;
  state.onChange(() => {
    throw new Error('listener');
  });
  state.onChange(() => {
    reached = true;
  });
  state.applyPacket(welcome());
  assert.equal(errors.length, 1);
  assert.equal(reached, true);
});

test('the client hands its onError to its state', () => {
  const errors: unknown[] = [];
  const page = { WebSocket: class {}, location: { host: 'h', href: 'https://h/' } } as unknown as PageLike;
  const client = new PokeIdleClient({ transport: new PageTransport(page), onError: (e) => errors.push(e) });
  client.state.onChange(() => {
    throw new Error('from state');
  });
  client.state.applyPacket(welcome());
  assert.equal(errors.length, 1);
});

test('a transport subscriber that throws goes to ITS onError; other subscribers still run', () => {
  class Sock extends EventTarget {
    readyState = 1;
    constructor(public url: string) {
      super();
    }
    send(): void {}
  }
  const page = {
    WebSocket: class extends Sock {},
    location: { host: 'g', href: 'https://g/app' },
  } as unknown as PageLike;
  const mine: unknown[] = [];
  const got: string[] = [];
  new PageTransport(page).start({
    onMessage: () => {
      throw new Error('mine');
    },
    onError: (e) => mine.push(e),
  });
  new PageTransport(page).start({ onMessage: (t) => got.push(t) });
  const ws = new (page as unknown as { WebSocket: new (u: string) => Sock }).WebSocket('wss://g/');
  ws.dispatchEvent(Object.assign(new Event('message'), { data: 'hi' }));
  assert.equal(mine.length, 1);
  assert.deepEqual(got, ['hi']);
});

test('the library writes to the console in exactly one place', () => {
  const dir = fileURLToPath(new URL('../src/', import.meta.url));
  const offenders = readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts') && f !== 'errors.ts')
    .filter((f) => /\bconsole\.(log|error|warn|info|debug)\b/.test(readFileSync(dir + f, 'utf8')));
  assert.deepEqual(offenders, []);
});

test('an onError that throws never escapes: the default handler gets the original error', () => {
  const spy = mock.method(console, 'error', () => undefined);
  try {
    const original = new Error('original');
    const state = new GameState({
      onError: () => {
        throw new Error('handler bug');
      },
    });
    let later = false;
    state.onChange(() => {
      throw original;
    });
    state.onChange(() => {
      later = true;
    });
    state.applyPacket(welcome());
    assert.equal(later, true);
    assert.equal(spy.mock.callCount(), 1);
    assert.equal(spy.mock.calls[0]?.arguments[1], original);
  } finally {
    spy.mock.restore();
  }
});
