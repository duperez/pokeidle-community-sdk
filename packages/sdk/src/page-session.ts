import { PokeIdleClient as Core } from './client-core.js';
import { PageTransport, type PageLike } from './page-transport.js';
import { DEFAULT_MAX_PACKET_BYTES, type Packet, type IgnoredReason } from './packets.js';
import { DEFAULTS, resolveChecks, validateOptions } from './actions-options.js';
import type { ActionCallOptions, ActionsOptions, BuyResult, SellResult, Scheduler, SendOutcome } from './actions-types.js';
import { defaultErrorHandler, guarded, type ErrorHandler } from './errors.js';
import { deepFreeze } from './immutable.js';
import type { GameState } from './state.js';
import { PageSessionError } from './page-session-error.js';

export type SharedActionsOptions = Omit<ActionsOptions, 'scheduler'>;

export interface BootstrapOptions {
  maxPacketBytes?: number;
  actions?: SharedActionsOptions;
}

interface Policy {
  maxPacketBytes: number;
  actions: Omit<ActionsOptions, 'scheduler'>;
}

export interface Consumer {
  packet(packet: Packet, changed: boolean): void;
  outgoing(packet: Packet): void;
  connection(connected: boolean): void;
  ignored(reason: IgnoredReason): void;
  onError: ErrorHandler;
}

export interface PageSession {
  readonly connected: boolean;
  readonly generation: number;
  readonly spentLastHour: number;
  readonly busy: boolean;
  capture(): GameState;
  attach(consumer: Consumer): void;
  detach(consumer: Consumer): void;
  send(text: string): boolean;
  buy(consumer: Consumer, kind: 'ball' | 'item', id: number, quantity: number, options: ActionCallOptions): Promise<BuyResult>;
  sell(consumer: Consumer, id: number, options: ActionCallOptions & { confirmIrreversible?: boolean }): Promise<SellResult>;
}

const SLOT = Symbol.for('pokeidle-community-sdk.page-session');
const LEGACY = Symbol.for('pokeidle-community-sdk.page-hook');
const ABI = 1;
const CAPABILITIES = ['shared-state', 'shared-writer', 'consumer-lifecycle'] as const;

function policyOf(options: BootstrapOptions): Policy {
  if (options === null || typeof options !== 'object' || 'transport' in options) throw new PageSessionError('invalid-options');
  const action = options.actions ?? {};
  if (action === null || typeof action !== 'object' || 'scheduler' in action) throw new PageSessionError('invalid-options');
  if (action.dryRun !== undefined && typeof action.dryRun !== 'boolean') throw new PageSessionError('invalid-options');
  if (action.rateLimit !== undefined && action.rateLimit !== false && (action.rateLimit === null || typeof action.rateLimit !== 'object'))
    throw new PageSessionError('invalid-options');
  if (action.checks !== undefined && typeof action.checks !== 'boolean' && (action.checks === null || typeof action.checks !== 'object'))
    throw new PageSessionError('invalid-options');
  const checks = resolveChecks(action.checks);
  if (Object.values(checks).some((value) => typeof value !== 'boolean')) throw new PageSessionError('invalid-options');
  try {
    validateOptions(action);
  } catch (error) {
    if (error instanceof RangeError) throw new PageSessionError('invalid-options');
    throw error;
  }
  const maxPacketBytes = options.maxPacketBytes ?? DEFAULT_MAX_PACKET_BYTES;
  if (!Number.isSafeInteger(maxPacketBytes) || maxPacketBytes < 0) throw new PageSessionError('invalid-options');
  return deepFreeze({
    maxPacketBytes,
    actions: {
      dryRun: action.dryRun ?? false,
      rateLimit:
        action.rateLimit === false
          ? false
          : {
              minIntervalMs: action.rateLimit?.minIntervalMs ?? DEFAULTS.minIntervalMs,
              maxPerMinute: action.rateLimit?.maxPerMinute ?? DEFAULTS.maxPerMinute,
            },
      ...(action.maxGoldPerHour === undefined ? {} : { maxGoldPerHour: action.maxGoldPerHour }),
      confirmTimeoutMs: action.confirmTimeoutMs ?? DEFAULTS.confirmTimeoutMs,
      confirmGraceMs: action.confirmGraceMs ?? DEFAULTS.confirmGraceMs,
      unconfirmedCooldownMs: action.unconfirmedCooldownMs ?? DEFAULTS.unconfirmedCooldownMs,
      checks,
    },
  });
}

type ActionResult = BuyResult | SellResult;
interface Operation {
  owner: Consumer;
  receipt: boolean;
  stopped: boolean;
  possiblySent: boolean;
  stop(): void;
}

class Runtime implements PageSession {
  readonly #core: Core;
  readonly #consumers = new Set<Consumer>();
  #snapshot: GameState;
  #dirty = false;
  #operation: Operation | null = null;

  constructor(page: PageLike, policy: Policy, scheduler?: Scheduler) {
    this.#core = new Core({
      transport: new PageTransport(page),
      inspector: false,
      maxPacketBytes: policy.maxPacketBytes,
      actions: { ...policy.actions, ...(scheduler ? { scheduler } : {}) },
      onError: () => defaultErrorHandler(new PageSessionError('core-failure')),
      actionError: (error) => {
        const owner = this.#operation?.owner;
        if (owner) guarded(owner.onError, () => owner.onError(error));
        else defaultErrorHandler(new PageSessionError('core-failure'));
      },
      onIgnored: (reason) => this.each((consumer) => consumer.ignored(reason)),
    });
    this.#snapshot = this.#core.state.snapshot();
    this.#core.state.onChange(() => {
      this.#dirty = true;
    });
    this.#core.onPacket((packet) => {
      const changed = this.refresh();
      this.each((consumer) => consumer.packet(packet, changed));
    });
    this.#core.onOutgoing((packet) => this.each((consumer) => consumer.outgoing(packet)));
    this.#core.onConnectionChange((connected) => {
      this.refresh();
      this.each((consumer) => consumer.connection(connected));
    });
    this.#core.start();
  }

  get connected(): boolean {
    return this.#core.connected;
  }
  get generation(): number {
    return this.#core.generation;
  }
  get spentLastHour(): number {
    return this.#core.actions.spentLastHour;
  }
  get busy(): boolean {
    return this.#operation !== null || this.#core.actions.busy;
  }
  capture(): GameState {
    return this.#snapshot;
  }
  attach(consumer: Consumer): void {
    this.#consumers.add(consumer);
  }
  detach(consumer: Consumer): void {
    this.#consumers.delete(consumer);
    if (this.#operation?.owner === consumer) {
      this.#operation.stopped = true;
      if (this.#operation.receipt && this.#operation.possiblySent) this.#operation.stop();
    }
  }

  send(text: string): boolean {
    if (this.#operation || this.#core.actions.busy) throw new PageSessionError('busy');
    try {
      const sent = this.#core.sendRaw(text);
      if (sent) this.#core.markLowLevelWrite();
      return sent;
    } catch (error) {
      this.#core.markLowLevelWrite();
      throw error;
    }
  }

  buy(owner: Consumer, kind: 'ball' | 'item', id: number, quantity: number, options: ActionCallOptions): Promise<BuyResult> {
    return this.execute(owner, options, (call) =>
      kind === 'ball' ? this.#core.actions.buyBall(id, quantity, call) : this.#core.actions.buyItem(id, quantity, call),
    ) as Promise<BuyResult>;
  }

  sell(owner: Consumer, id: number, options: ActionCallOptions & { confirmIrreversible?: boolean }): Promise<SellResult> {
    return this.execute(owner, options, (call) =>
      this.#core.actions.sellPokemon(id, {
        ...call,
        ...(options.confirmIrreversible === undefined ? {} : { confirmIrreversible: options.confirmIrreversible }),
      }),
    ) as Promise<SellResult>;
  }

  private execute(
    owner: Consumer,
    options: ActionCallOptions,
    invoke: (options: ActionCallOptions) => Promise<ActionResult>,
  ): Promise<ActionResult> {
    if (!this.#consumers.has(owner)) return Promise.resolve({ status: 'not-connected' });
    if (this.#operation || this.#core.actions.busy) return Promise.resolve({ status: 'busy' });
    this.#core.beginAction();
    let resolveLocal: (result: ActionResult) => void = () => {};
    let rejectLocal: (error: unknown) => void = () => {};
    const local = new Promise<ActionResult>((resolve, reject) => {
      resolveLocal = resolve;
      rejectLocal = reject;
    });
    const operation: Operation = {
      owner,
      receipt: false,
      stopped: false,
      possiblySent: false,
      stop: () => {
        const result = this.#core.actions.detach();
        if (result !== null) resolveLocal(deepFreeze(result));
      },
    };
    this.#operation = operation;
    const pending = invoke({
      ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
      onSend: (outcome: SendOutcome) => {
        operation.receipt = true;
        operation.possiblySent = outcome.status !== 'not-sent';
        guarded(owner.onError, () => options.onSend?.(outcome));
        if (operation.stopped && operation.possiblySent) operation.stop();
      },
    });
    if (!this.#core.actions.busy && this.#operation === operation) this.#operation = null;
    void pending.then(
      (result) => {
        if (this.#operation === operation) this.#operation = null;
        resolveLocal(deepFreeze(result));
      },
      (error: unknown) => {
        if (this.#operation === operation) this.#operation = null;
        rejectLocal(error);
      },
    );
    return local;
  }

  private refresh(): boolean {
    if (this.#dirty) {
      this.#snapshot = this.#core.state.snapshot();
      this.#dirty = false;
      return true;
    }
    return false;
  }
  private each(deliver: (consumer: Consumer) => void): void {
    const generation = this.generation;
    for (const consumer of [...this.#consumers]) {
      if (this.generation !== generation) break;
      if (this.#consumers.has(consumer)) guarded(consumer.onError, () => deliver(consumer));
    }
  }
}

/** Internal page/clock seam used by deterministic tests; never exported from the package. */
export function ensurePageSession(page: PageLike, options?: BootstrapOptions, scheduler?: Scheduler): PageSession {
  const policy = options === undefined ? undefined : policyOf(options);
  if (typeof page.WebSocket !== 'function' || typeof page.location?.host !== 'string' || typeof page.location?.href !== 'string')
    throw new PageSessionError('unsupported-context');
  const occupied = Object.getOwnPropertyDescriptor(page, SLOT);
  if (occupied) {
    const slot: unknown = occupied.value;
    if (slot === null || typeof slot !== 'object') throw new PageSessionError('incompatible-runtime');
    const descriptor = slot as { abi?: unknown; capabilities?: unknown; policy?: unknown; runtime?: unknown };
    const capabilities = descriptor.capabilities;
    if (descriptor.abi !== ABI || !Array.isArray(capabilities) || !CAPABILITIES.every((capability) => capabilities.includes(capability)))
      throw new PageSessionError('incompatible-runtime');
    const runtime = descriptor.runtime as PageSession | undefined;
    if (
      !runtime ||
      typeof runtime !== 'object' ||
      typeof descriptor.policy !== 'string' ||
      !['attach', 'detach', 'capture', 'send', 'buy', 'sell'].every((name) => typeof Reflect.get(runtime, name) === 'function')
    )
      throw new PageSessionError('incompatible-runtime');
    if (policy !== undefined && descriptor.policy !== JSON.stringify(policy)) throw new PageSessionError('configuration-conflict');
    return runtime;
  }
  if (Object.getOwnPropertyDescriptor(page, LEGACY)) throw new PageSessionError('incompatible-runtime');
  const effective = policy ?? policyOf({});
  const runtime = new Runtime(page, effective, scheduler);
  Object.defineProperty(page, SLOT, {
    configurable: true,
    value: Object.freeze({ abi: ABI, capabilities: Object.freeze([...CAPABILITIES]), policy: JSON.stringify(effective), runtime }),
  });
  return runtime;
}

/** Installs collection in the page's MAIN world, independently of consumer attachment. */
export function bootstrapPageSession(options: BootstrapOptions = {}): void {
  ensurePageSession(globalThis, options);
}
