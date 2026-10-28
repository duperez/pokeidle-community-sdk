export function page(t: { after(fn: () => void): void }) {
  const keys = ['WebSocket', 'location', Symbol.for('pokeidle-community-sdk.page-session'), Symbol.for('pokeidle-community-sdk.page-hook')];
  const saved = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  class Socket extends EventTarget {
    static writes: string[] = [];
    static onWrite: (() => void) | undefined;
    static error: Error | undefined;
    readyState = 0;
    constructor(public url: string) {
      super();
    }
    send(text: string): void {
      Socket.writes.push(text);
      Socket.onWrite?.();
      if (Socket.error) throw Socket.error;
    }
    open(): void {
      this.readyState = 1;
      this.dispatchEvent(new Event('open'));
    }
    feed(packet: object): void {
      this.raw(JSON.stringify(packet));
    }
    raw(text: string): void {
      this.dispatchEvent(Object.assign(new Event('message'), { data: text }));
    }
    close(): void {
      this.readyState = 3;
      this.dispatchEvent(new Event('close'));
    }
  }
  for (const key of keys) Reflect.deleteProperty(globalThis, key);
  Object.defineProperties(globalThis, {
    WebSocket: { value: Socket, writable: true, configurable: true },
    location: { value: { host: 'game.example', href: 'https://game.example/' }, configurable: true },
  });
  t.after(() => {
    keys.forEach((key, index) => {
      Reflect.deleteProperty(globalThis, key);
      const descriptor = saved[index];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    });
  });
  return {
    Socket,
    socket() {
      const socket: unknown = new globalThis.WebSocket('wss://game.example/');
      if (!(socket instanceof Socket)) throw new Error('the page fixture did not preserve the native socket prototype');
      return socket;
    },
  };
}
