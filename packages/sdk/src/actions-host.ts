import type { Unsubscribe, PacketListener } from './listeners.js';
import type { BattleEventKind, BattleEventMap } from './protocol/events.js';
import type { SendableCommand } from './protocol/commands.js';
import type { GameState } from './state.js';

/** The part of the game state that actions read. Narrow on purpose: it is everything actions are allowed to depend on. */
export type ActionsState = Pick<
  GameState,
  | 'complete'
  | 'gold'
  | 'ballCount'
  | 'itemCount'
  | 'ballCatalog'
  | 'shopItems'
  | 'ballName'
  | 'itemName'
  | 'onChange'
  | 'pokemon'
  | 'pokemons'
  | 'isActive'
  | 'isInTeam'
  | 'isInCollection'
  | 'holdsExpShare'
>;

/**
 * What actions need from the world: a connection, the state, a way to listen for the game's answers and a way to send a
 * command. `PokeIdleClient` provides it, and so can anything else (a test double, another transport), because actions
 * depend on this interface and not on the client class.
 */
export interface ActionsHost {
  readonly connected: boolean;
  readonly state: ActionsState;
  /** Called with `false` when the connection drops and `true` when one opens. */
  onConnectionChange(listener: (connected: boolean) => void): Unsubscribe;
  /** Listens for packets of any type name (used for the game's `erro`). */
  onType(type: string, listener: PacketListener): Unsubscribe;
  onBattleEvent<K extends BattleEventKind>(kind: K, listener: (event: BattleEventMap[K]) => void): Unsubscribe;
  sendCommand(command: SendableCommand, options?: { confirmIrreversible?: boolean }): boolean | Promise<boolean>;
}
