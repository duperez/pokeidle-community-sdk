import type { ErrorHandler } from './errors.js';

/**
 * What a transport tells one account's client. Frames are raw, exactly as the game sent them.
 * The transport must ignore events from replaced sockets/webviews and detach on stop; onOpen denotes a new connection.
 */
export interface TransportHandlers {
  /** A frame arrived from the server. */
  onMessage(text: string): void;
  /** A frame was sent by the game's own client (observed, not sent by the SDK). */
  onOutgoing?(text: string): void;
  /** A different socket was adopted, including a successor that is still connecting. */
  onBoundary?(): void;
  onOpen?(): void;
  onClose?(): void;
  /** Where the transport reports an error thrown by one of these handlers (it must not stop the other subscribers). */
  onError?: ErrorHandler;
}

/**
 * What `send` returns: `true`/`false` right away (a transport that can write to the socket synchronously, like
 * `PageTransport`) or a promise of it (a host where the write is asynchronous, like a launcher that reaches the page
 * over IPC). `true` means the frame was accepted for sending, not that the game acted on it.
 */
export type SendResult = boolean | Promise<boolean>;

/**
 * How the SDK talks to the game. The core never knows where the frames come from, so the same code runs in a page
 * (`PageTransport`) and, later, in other hosts (for example a launcher that reads the socket from outside the page).
 */
export interface Transport<S extends SendResult = boolean> {
  start(handlers: TransportHandlers): void;
  stop(): void;
  /**
   * Sends a text frame through the game's socket. `true` means accepted, not applied by the game. Return/resolve `false`
   * only when definitely not sent. A throw or rejection has an uncertain outcome (except CommandRefusedError, which is a
   * pre-send guard); Actions reports it and counts it conservatively. A promised result must eventually settle.
   */
  send(text: string): S;
  /** WebSocket ready state of the game's socket (0 connecting, 1 open, 2 closing, 3 closed), or -1 if none was seen yet. */
  readonly readyState: number;
}
