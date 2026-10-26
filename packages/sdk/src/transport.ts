import type { ErrorHandler } from './errors.js';

/** What a transport tells the client. All handlers receive the raw text frame, exactly as the game sent it. */
export interface TransportHandlers {
  /** A frame arrived from the server. */
  onMessage(text: string): void;
  /** A frame was sent by the game's own client (observed, not sent by the SDK). */
  onOutgoing?(text: string): void;
  onOpen?(): void;
  onClose?(): void;
  /** Where the transport reports an error thrown by one of these handlers (it must not stop the other subscribers). */
  onError?: ErrorHandler;
}

/**
 * How the SDK talks to the game. The core never knows where the frames come from, so the same code runs in a page
 * (`PageTransport`) and, later, in other hosts (for example a launcher that reads the socket from outside the page).
 */
export interface Transport {
  start(handlers: TransportHandlers): void;
  stop(): void;
  /** Sends a text frame through the game's socket. `false` if there is no open socket. */
  send(text: string): boolean;
  /** WebSocket ready state of the game's socket (0 connecting, 1 open, 2 closing, 3 closed), or -1 if none was seen yet. */
  readonly readyState: number;
}
