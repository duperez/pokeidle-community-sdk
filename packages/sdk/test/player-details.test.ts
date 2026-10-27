import assert from 'node:assert/strict';
import test from 'node:test';
import { GameState } from '../src/index.js';

const update = (state: GameState, fields: Record<string, unknown>) => state.applyPacket({ t: 'estado', estado: fields });

test('known quantities distinguish an unavailable map, a missing id, zero and malformed values', () => {
  const state = new GameState();
  for (const kind of ['ball', 'item'] as const) {
    const read = kind === 'ball' ? (id: number) => state.ballQuantity(id) : (id: number) => state.itemQuantity(id);
    const field = kind === 'ball' ? 'balls' : 'items';
    for (const map of [undefined, null, [], 'invalid', 2]) {
      update(state, { [field]: map });
      assert.equal(read(1), null);
    }
    update(state, { [field]: { 1: 0, 2: 12, 3: 0.5 } });
    assert.equal(read(1), 0);
    assert.equal(read(2), 12);
    assert.equal(read(3), 0.5);
    assert.equal(read(4), 0);
    for (const id of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.equal(read(id), null);
    for (const value of [undefined, null, true, '12', -1, NaN, Infinity, {}]) {
      update(state, { [field]: { 1: value } });
      assert.equal(read(1), null);
    }
  }
  assert.equal(state.itemCount(1), 0, 'legacy helpers retain their unknown-to-zero contract');
  assert.equal(state.ballCount(1), 0);
});

test('automation and center facts preserve unknown, filter invalid ids and own their snapshots', () => {
  const state = new GameState();
  const read = () => state.automation;
  assert.equal(read(), null);
  assert.equal(state.inCenter, null);
  for (const automation of [null, [], 1]) {
    update(state, { automation });
    assert.equal(read(), null);
  }
  const automation = {
    ballIds: [1, '2', 2, 0, -1, 1.5, null, true, 'bad', Number.MAX_SAFE_INTEGER + 1],
    reviveIds: [],
    potionIds: 'unknown',
  };
  update(state, { automation, noCentro: false });
  const snapshot = state.automation;
  assert.deepEqual(snapshot, { ballIds: [1, 2], reviveIds: [], potionIds: null });
  assert.equal(state.automation, snapshot);
  assert.equal(state.inCenter, false);
  automation.ballIds[0] = 9;
  assert.deepEqual(snapshot?.ballIds, [1, 2]);
  assert.equal(Reflect.set(snapshot?.ballIds ?? [], '0', 9), false);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot?.ballIds));
  update(state, { automation: { potionIds: [200] }, noCentro: true });
  assert.deepEqual(state.automation, { ballIds: null, reviveIds: null, potionIds: [200] });
  assert.notEqual(state.automation, snapshot);
  assert.deepEqual(snapshot?.ballIds, [1, 2]);
  assert.equal(state.inCenter, true);
  update(state, { noCentro: 'true' });
  assert.equal(state.inCenter, null);
});

test('Twitch normalizes facts independently, including numeric text and both watching-channel shapes', () => {
  const state = new GameState();
  const read = () => state.twitch;
  assert.equal(read(), null);
  update(state, {
    twitch: {
      login: ' viewer ',
      aoVivo: false,
      assistindo: true,
      emLives: '2',
      assistindoEm: [' first ', { login: 'second' }, { login: '' }, null, true],
      pct: '1.5',
      extra: 2,
      pctAtual: '3.5',
      canal: ' reported ',
      oficiais: [
        { login: 'first', nome: ' First ', bonus: true, espectadores: '42' },
        { login: 'other', nome: 789, bonus: false, espectadores: 0 },
        { login: 456 },
        { nome: 'no login' },
        null,
      ],
      lives: [{ login: 'third', bonus: 'yes', espectadores: 'bad' }],
    },
  });
  assert.deepEqual(state.twitch, {
    login: 'viewer',
    aoVivo: false,
    assistindo: true,
    emLives: 2,
    assistindoEm: ['first', 'second'],
    pct: 1.5,
    extra: 2,
    pctAtual: 3.5,
    canal: 'reported',
    oficiais: [
      { login: 'first', nome: 'First', bonus: true, espectadores: 42 },
      { login: 'other', nome: null, bonus: false, espectadores: 0 },
    ],
    lives: [{ login: 'third', nome: null, bonus: null, espectadores: null }],
  });
  const snapshot = state.twitch;
  assert.equal(state.twitch, snapshot);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot?.assistindoEm));
  assert.ok(Object.isFrozen(snapshot?.oficiais));
  assert.ok(Object.isFrozen(snapshot?.oficiais?.[0]));
  update(state, { twitch: {} });
  assert.equal(state.twitch?.aoVivo, null, 'a missing boolean is not false');
  assert.equal(state.twitch?.emLives, null, 'do not derive the live count from a list');
  assert.equal(state.twitch?.canal, null);
  assert.equal(snapshot?.login, 'viewer', 'later packets do not alter an old snapshot');
});

test('malformed Twitch fields remain unknown; empty known lists stay empty', () => {
  const state = new GameState();
  const read = () => state.twitch;
  for (const twitch of [null, [], false, 'bad']) {
    update(state, { twitch });
    assert.equal(read(), null);
  }
  for (const invalid of [null, undefined, true, '', ' ', 'no', {}, [], NaN, Infinity]) {
    update(state, {
      twitch: { login: {}, aoVivo: 'true', assistindo: 1, emLives: invalid, pct: invalid, extra: invalid, pctAtual: invalid },
    });
    assert.deepEqual(state.twitch, {
      login: null,
      aoVivo: null,
      assistindo: null,
      emLives: null,
      assistindoEm: null,
      pct: null,
      extra: null,
      pctAtual: null,
      canal: null,
      oficiais: null,
      lives: null,
    });
  }
  update(state, { twitch: { assistindoEm: [], oficiais: [], lives: [] } });
  assert.deepEqual(state.twitch?.assistindoEm, []);
  assert.deepEqual(state.twitch?.oficiais, []);
  assert.deepEqual(state.twitch?.lives, []);
  update(state, { twitch: { login: 123, canal: 456, assistindoEm: [789, { login: 123 }] } });
  assert.equal(state.twitch?.login, null);
  assert.equal(state.twitch?.canal, null);
  assert.deepEqual(state.twitch?.assistindoEm, []);
});

test('normalized facts do not impose UI truncation, remain last-known when stale and reset on a new full state', () => {
  const state = new GameState();
  const login = 'channel'.repeat(10);
  const channels = Array.from({ length: 60 }, (_, i) => ({ login: `${login}${i}`, nome: login }));
  state.applyPacket({
    t: 'welcome',
    estado: {
      noCentro: false,
      items: { 200: 5 },
      automation: { ballIds: [1] },
      twitch: { login, assistindoEm: channels, oficiais: channels, lives: channels },
    },
  });
  assert.equal(state.twitch?.login, login);
  assert.equal(state.twitch?.assistindoEm?.length, 60);
  assert.equal(state.twitch?.oficiais?.length, 60);
  assert.equal(state.twitch?.lives?.[0]?.nome, login);
  state.markStale();
  assert.equal(state.complete, false);
  assert.equal(state.itemQuantity(200), 5);
  assert.equal(state.inCenter, false);
  assert.equal(state.twitch?.login, login);
  assert.deepEqual(state.automation?.ballIds, [1]);
  state.applyPacket({ t: 'welcome', estado: {} });
  assert.equal(state.itemQuantity(200), null);
  assert.equal(state.inCenter, null);
  assert.equal(state.automation, null);
  assert.equal(state.twitch, null);
});
