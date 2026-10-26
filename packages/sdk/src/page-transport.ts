import { defaultErrorHandler, guarded } from './errors.js';
import type { Transport, TransportHandlers } from './transport.js';

/** Minimal view of the page the transport needs. Tests pass a fake; in a real page it is `window`. */
export interface PageLike {
  WebSocket: typeof WebSocket;
  location: { host: string; href: string };
}

interface SharedHook {
  readonly version: 1;
  socket: WebSocket | null;
  readonly subscribers: Set<TransportHandlers>;
  readonly originalSend: WebSocket['send'];
}

const HOOK_KEY = Symbol.for('pokeidle-community-sdk.page-hook');
type WithHook = PageLike & { [HOOK_KEY]?: SharedHook };

/**
 * Reads and sends through the game's WebSocket from inside the page.
 *
 * It must run in the page's own JavaScript world and before the game opens its socket (a Manifest V3 content script with
 * `"world": "MAIN"` and `"run_at": "document_start"`). The hook is shared: if several extensions bundle the SDK, the page
 * is patched once and every copy subscribes to the same hook.
 *
 * The game's socket is the one on the page's own host with the path `/`; any other socket is left alone.
 */
export class PageTransport implements Transport {
  private hook: SharedHook | null = null;
  private handlers: TransportHandlers | null = null;
  private subscription: TransportHandlers | null = null;

  constructor(private readonly page: PageLike = globalThis) {}

  get readyState(): number {
    return this.hook?.socket?.readyState ?? -1;
  }

  start(handlers: TransportHandlers): void {
    if (this.handlers) return;
    this.handlers = handlers;
    this.hook = installHook(this.page);
    // Each subscriber is guarded with ITS error handler: one that throws reaches its owner and never the other subscribers.
    const onError = handlers.onError ?? defaultErrorHandler;
    this.subscription = {
      onMessage: (text) => guarded(onError, () => handlers.onMessage(text)),
      onOutgoing: (text) => guarded(onError, () => handlers.onOutgoing?.(text)),
      onOpen: () => guarded(onError, () => handlers.onOpen?.()),
      onClose: () => guarded(onError, () => handlers.onClose?.()),
    };
    this.hook.subscribers.add(this.subscription);
    // A socket adopted before this transport started is already open: say so, or the client would think it is offline.
    if (this.hook.socket?.readyState === 1) handlers.onOpen?.();
  }

  stop(): void {
    if (!this.handlers || !this.hook) return;
    if (this.subscription) this.hook.subscribers.delete(this.subscription);
    this.subscription = null;
    this.handlers = null;
    this.hook = null; // the page patch stays: other copies may share it and it is harmless without subscribers
  }

  send(text: string): boolean {
    const hook = this.hook;
    const socket = hook?.socket;
    if (!hook || !socket || socket.readyState !== 1) return false;
    hook.originalSend.call(socket, text); // the original send: the SDK's own frames are not reported as the game's
    return true;
  }
}

function installHook(page: WithHook): SharedHook {
  const existing = page[HOOK_KEY];
  if (existing) return existing;

  const Original = page.WebSocket;
  // Taken unbound on purpose: it is called later with `.call` on the right socket.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalSend = Original.prototype.send;
  const hook: SharedHook = { version: 1, socket: null, subscribers: new Set(), originalSend };
  const adopted = new WeakSet<object>();

  const isGameSocket = (ws: { url?: unknown }): boolean => {
    try {
      const url = new URL(String(ws.url), page.location.href);
      return url.host === page.location.host && url.pathname === '/';
    } catch {
      return false;
    }
  };
  // Backstop for subscribers that are not guarded (another copy of the SDK, an older version): never let one stop the rest.
  const each = (fn: (h: TransportHandlers) => void): void => {
    for (const h of [...hook.subscribers]) guarded(defaultErrorHandler, () => fn(h));
  };
  const adopt = (ws: WebSocket): void => {
    hook.socket = ws;
    if (adopted.has(ws)) return;
    adopted.add(ws);
    ws.addEventListener('message', (event) => {
      if (typeof event.data === 'string') each((h) => h.onMessage(event.data as string));
    });
    ws.addEventListener('open', () => each((h) => h.onOpen?.()));
    ws.addEventListener('close', () => each((h) => h.onClose?.()));
  };

  page.WebSocket = new Proxy(Original, {
    construct(target, args, newTarget) {
      const ws = Reflect.construct(target, args, newTarget) as WebSocket;
      if (isGameSocket(ws)) adopt(ws);
      return ws;
    },
  });
  // Backup for a socket created before the hook existed: it is adopted the first time the game sends something.
  Original.prototype.send = function (this: WebSocket, data: Parameters<WebSocket['send']>[0]) {
    if (isGameSocket(this)) {
      if (hook.socket !== this) {
        adopt(this);
        if (this.readyState === 1) each((h) => h.onOpen?.()); // adopted late: it was already open
      }
      if (typeof data === 'string') each((h) => h.onOutgoing?.(data));
    }
    return originalSend.call(this, data);
  };

  page[HOOK_KEY] = hook;
  return hook;
}
