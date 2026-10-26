import type { Packet } from './packets.js';

/** Stops a subscription. Calling it twice is harmless. */
export type Unsubscribe = () => void;

export type PacketListener = (packet: Packet) => void;
