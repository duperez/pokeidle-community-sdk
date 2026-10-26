import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLIENT_COMMAND_TYPES,
  CommandRefusedError,
  FORBIDDEN_COMMANDS,
  IRREVERSIBLE_COMMANDS,
  PokeIdleClient,
  isForbiddenCommand,
  isIrreversibleCommand,
  type Transport,
  type TransportHandlers,
} from '../src/index.js';

class FakeTransport implements Transport {
  sent: string[] = [];
  readyState = 1;
  start(_handlers: TransportHandlers): void {}
  stop(): void {}
  send(text: string): boolean {
    this.sent.push(text);
    return true;
  }
}
const setup = () => {
  const transport = new FakeTransport();
  return { transport, client: new PokeIdleClient({ transport }) };
};

test("every name in the safety lists exists in the game's client (a typo would silently protect nothing)", () => {
  const known = new Set<string>(CLIENT_COMMAND_TYPES);
  for (const name of [...FORBIDDEN_COMMANDS, ...IRREVERSIBLE_COMMANDS]) assert.ok(known.has(name), name);
  assert.equal(new Set(IRREVERSIBLE_COMMANDS).size, IRREVERSIBLE_COMMANDS.length);
  for (const name of FORBIDDEN_COMMANDS) assert.ok(!isIrreversibleCommand(name), `${name} is forbidden, not merely irreversible`);
});

test('the command that withdraws real cryptocurrency is refused, even when the types are bypassed', () => {
  const { transport, client } = setup();
  assert.equal(isForbiddenCommand('orbs.sacar'), true);
  const bypass = { t: 'orbs.sacar', orbs: 1000, rede: 'x', endereco: 'y' } as never; // the compiler already rejects this
  assert.throws(() => client.sendCommand(bypass), CommandRefusedError);
  assert.throws(() => client.sendCommand(bypass, { confirmIrreversible: true }), /never sent by the SDK/);
  assert.deepEqual(transport.sent, []);
});

test('irreversible commands need an explicit confirmation; routine ones do not', () => {
  const { transport, client } = setup();
  assert.throws(() => client.sendCommand({ t: 'shop.sellPokemon', pokemonId: 5 }), /confirmIrreversible/);
  assert.throws(() => client.sendCommand({ t: 'guild.apagar' }), CommandRefusedError);
  assert.deepEqual(transport.sent, []);
  assert.equal(client.sendCommand({ t: 'shop.sellPokemon', pokemonId: 5 }, { confirmIrreversible: true }), true);
  assert.equal(client.sendCommand({ t: 'shop.buy', kind: 'ball', id: 4, qty: 2 }), true); // routine: spending a little gold on balls
  assert.equal(client.sendCommand({ t: 'item.use', itemId: 1 }), true);
  assert.equal(isIrreversibleCommand('shop.buy'), false);
  assert.equal(transport.sent.length, 3);
});

test('numbers must be finite and counts must be positive integers', () => {
  const { transport, client } = setup();
  for (const qty of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => client.sendCommand({ t: 'shop.buy', kind: 'ball', id: 4, qty }), CommandRefusedError, String(qty));
  }
  assert.throws(() => client.sendCommand({ t: 'item.use', itemId: Number.NaN }), /finite/);
  assert.deepEqual(transport.sent, []); // nothing reached the socket
});

test('a command without a string type is refused', () => {
  const { client } = setup();
  assert.throws(() => client.sendCommand({ t: 5 } as never), CommandRefusedError);
  assert.throws(() => client.sendCommand({} as never), CommandRefusedError);
});

test('the compiler itself rejects the forbidden command and a typo in on()', () => {
  const { client } = setup();
  // @ts-expect-error `orbs.sacar` is not a SendableCommand
  assert.throws(() => client.sendCommand({ t: 'orbs.sacar', orbs: 1, rede: 'x', endereco: 'y' }), CommandRefusedError);
  // @ts-expect-error 'wellcome' is not a packet type the game handles (use onType for types the SDK does not know)
  client.on('wellcome', () => {});
});
