import { isForbiddenCommand, isIrreversibleCommand, type SendableCommand } from './commands.js';

export type { SendableCommand } from './commands.js';

/** Thrown by `sendCommand` when a guard refuses a command. It is a programming mistake, so it is loud. */
export class CommandRefusedError extends Error {
  constructor(readonly command: string, reason: string) {
    super(`refused to send "${command}": ${reason}`);
    this.name = 'CommandRefusedError';
  }
}

const COUNT_FIELDS = new Set(['qty', 'qtd']);

/** Runs the guards of `sendCommand`. Works on the run-time value, so it also protects callers that bypass the types. */
export function assertSendable(command: SendableCommand, confirmIrreversible: boolean): void {
  const type = (command as { t?: unknown }).t;
  if (typeof type !== 'string' || type === '') throw new CommandRefusedError(String(type), 'a command needs a string `t`');
  if (isForbiddenCommand(type)) throw new CommandRefusedError(type, 'this command is never sent by the SDK (it moves money out of the game)');
  if (isIrreversibleCommand(type) && !confirmIrreversible) {
    throw new CommandRefusedError(type, 'it cannot be undone or spends something valuable: pass { confirmIrreversible: true } if you mean it');
  }
  for (const [field, value] of Object.entries(command)) {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new CommandRefusedError(type, `\`${field}\` is not a finite number`);
    if (COUNT_FIELDS.has(field) && !(Number.isInteger(value) && (value as number) >= 1)) throw new CommandRefusedError(type, `\`${field}\` must be a positive integer`);
  }
}
