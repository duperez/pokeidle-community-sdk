import assert from 'node:assert/strict';
import test from 'node:test';
import { PageTransport, type PageLike } from '../src/index.js';

/** A tiny WebSocket stand-in: enough surface for the hook (url, readyState, send, listeners). */
class FakeWebSocket extends EventTarget {
  static sentFrames: string[] = [];
  readyState = 0;
  constructor(public url: string) {
    super();
  }
  send(data: string): void {
    FakeWebSocket.sentFrames.push(data);
  }
  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }
  receive(text: string): void {
    this.dispatchEvent(Object.assign(new Event('message'), { data: text }));
  }
  close(): void {
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }
}

const newPage = (): PageLike & { WebSocket: typeof FakeWebSocket } => {
  // each page gets its own class so prototype patches do not leak between tests
  const Socket = class extends FakeWebSocket {};
  return {
    WebSocket: Socket as unknown as typeof WebSocket,
    location: { host: 'game.example', href: 'https://game.example/app' },
  } as never;
};
const handlersLog = () => {
  const log: string[] = [];
  return {
    log,
    handlers: {
      onMessage: (t: string) => log.push(`in:${t}`),
      onOutgoing: (t: string) => log.push(`out:${t}`),
      onOpen: () => log.push('open'),
      onClose: () => log.push('close'),
    },
  };
};

test('adopts the game socket (page host, path /) and reports its traffic', () => {
  const page = newPage();
  const transport = new PageTransport(page);
  const { log, handlers } = handlersLog();
  transport.start(handlers);
  const ws = new page.WebSocket('wss://game.example/') as unknown as FakeWebSocket;
  ws.open();
  ws.receive('{"t":"pong"}');
  ws.send('{"t":"ping"}');
  ws.close();
  assert.deepEqual(log, ['open', 'in:{"t":"pong"}', 'out:{"t":"ping"}', 'close']);
});

test('leaves other sockets alone', () => {
  const page = newPage();
  const transport = new PageTransport(page);
  const { log, handlers } = handlersLog();
  transport.start(handlers);
  for (const url of ['wss://other.example/', 'wss://game.example/other/path']) {
    const ws = new page.WebSocket(url) as unknown as FakeWebSocket;
    ws.open();
    ws.receive('{"t":"x"}');
    ws.send('{"t":"y"}');
  }
  assert.deepEqual(log, []);
  assert.equal(transport.readyState, -1);
});

test("send() uses the game socket without reporting it as the game's own frame", () => {
  const page = newPage();
  const transport = new PageTransport(page);
  const { log, handlers } = handlersLog();
  transport.start(handlers);
  assert.equal(transport.send('x'), false); // no socket yet
  const ws = new page.WebSocket('wss://game.example/') as unknown as FakeWebSocket;
  assert.equal(transport.send('x'), false); // connecting
  ws.open();
  FakeWebSocket.sentFrames.length = 0;
  assert.equal(transport.send('{"t":"mine"}'), true);
  assert.deepEqual(FakeWebSocket.sentFrames, ['{"t":"mine"}']);
  assert.ok(!log.some((l) => l.startsWith('out:')));
});

test('a socket created before the hook is adopted on its first send, and reported as already open', () => {
  const page = newPage();
  const early = new page.WebSocket('wss://game.example/') as unknown as FakeWebSocket;
  early.readyState = 1;
  const transport = new PageTransport(page);
  const { log, handlers } = handlersLog();
  transport.start(handlers);
  early.send('{"t":"first"}');
  assert.deepEqual(log, ['open', 'out:{"t":"first"}']);
  assert.equal(transport.readyState, 1);
});

test('two transports share one hook; stop() detaches only its own', () => {
  const page = newPage();
  const a = new PageTransport(page);
  const b = new PageTransport(page);
  const first = handlersLog();
  const second = handlersLog();
  a.start(first.handlers);
  b.start(second.handlers);
  const ws = new page.WebSocket('wss://game.example/') as unknown as FakeWebSocket;
  ws.open();
  a.stop();
  ws.receive('{"t":"pong"}');
  assert.deepEqual(first.log, ['open']);
  assert.deepEqual(second.log, ['open', 'in:{"t":"pong"}']);
});

test('a throwing handler does not stop the others', () => {
  const page = newPage();
  const a = new PageTransport(page);
  const b = new PageTransport(page);
  const quiet = console.error;
  console.error = () => {};
  try {
    a.start({
      onMessage() {
        throw new Error('boom');
      },
    });
    const ok = handlersLog();
    b.start(ok.handlers);
    const ws = new page.WebSocket('wss://game.example/') as unknown as FakeWebSocket;
    ws.receive('{"t":"pong"}');
    assert.deepEqual(ok.log, ['in:{"t":"pong"}']);
  } finally {
    console.error = quiet;
  }
});

test('a replaced socket is silent: its late close and messages do not reach the client', () => {
  const page = newPage();
  const transport = new PageTransport(page);
  const { log, handlers } = handlersLog();
  transport.start(handlers);
  const oldSocket = new page.WebSocket('wss://game.example/') as unknown as FakeWebSocket;
  oldSocket.open();
  const newSocket = new page.WebSocket('wss://game.example/') as unknown as FakeWebSocket;
  newSocket.open();
  log.length = 0;
  oldSocket.close(); // closes after its successor is up
  oldSocket.receive('{"t":"late"}');
  assert.deepEqual(log, []);
  newSocket.receive('{"t":"now"}');
  assert.deepEqual(log, ['in:{"t":"now"}']);
});

test('a replaced socket that sends does not take the transport back, and is not reported', () => {
  const page = newPage();
  const transport = new PageTransport(page);
  const { log, handlers } = handlersLog();
  transport.start(handlers);
  const oldSocket = new page.WebSocket('wss://game.example/') as unknown as FakeWebSocket;
  oldSocket.open();
  const newSocket = new page.WebSocket('wss://game.example/') as unknown as FakeWebSocket;
  newSocket.open();
  log.length = 0;
  oldSocket.send('{"t":"stale"}');
  assert.deepEqual(log, []);
  assert.equal(transport.send('{"t":"mine"}'), true);
  assert.equal(FakeWebSocket.sentFrames.at(-1), '{"t":"mine"}');
  newSocket.close();
  assert.deepEqual(log, ['close']); // the transport is still bound to the new socket
});
