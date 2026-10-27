// The mutations `npm run mutation` tries: each changes ONE thing in a safety-relevant file and the unit tests must fail.
// `from` must appear in the file exactly as written (the script fails if it does not: a mutation that is not applied
// proves nothing). Keep this list in step with the code it guards.

export const MUTATIONS = [
  // rate limiter
  { file: 'rate-limiter.ts', from: 'now < this.blockedUntil', to: 'now > this.blockedUntil' },
  { file: 'rate-limiter.ts', from: 'now - this.lastSentAt < minInterval', to: 'now - this.lastSentAt > minInterval' },
  { file: 'rate-limiter.ts', from: 'recent.length >= perMinute', to: 'recent.length > perMinute' },
  {
    file: 'rate-limiter.ts',
    from: 'if (limit === false) return null;',
    to: 'if (limit === false) return { status: "rate-limited", reason: "interval", retryInMs: 1 };',
  },
  { file: 'rate-limiter.ts', from: 'now + (this.options.unconfirmedCooldownMs', to: 'now - (this.options.unconfirmedCooldownMs' },
  // spend ledger
  { file: 'spend-ledger.ts', from: 'e.at > since', to: 'e.at >= since' },
  { file: 'spend-ledger.ts', from: 'sum + e.gold', to: 'sum - e.gold' },
  // waiter
  { file: 'wait-for-first.ts', from: 'if (done) return;\n    done = true;', to: 'done = true;' },
  { file: 'wait-for-first.ts', from: '    if (done)\n', to: '    if (false)\n' },
  { file: 'wait-for-first.ts', from: 'if (!done) timer =', to: 'if (true) timer =' },
  // sale rules (fail closed)
  { file: 'sale-rules.ts', from: 'if (active === null)', to: 'if (active === undefined)' },
  { file: 'sale-rules.ts', from: 'if (inTeam === null)', to: 'if (inTeam === undefined)' },
  { file: 'sale-rules.ts', from: 'if (inTeam) return', to: 'if (!inTeam) return' },
  { file: 'sale-rules.ts', from: 'if (inCollection === null)', to: 'if (inCollection === undefined)' },
  { file: 'sale-rules.ts', from: 'if (holdsExpShare === null)', to: 'if (holdsExpShare === undefined)' },
  // pokémon and state queries
  { file: 'pokemon.ts', from: 'wire.slot !== undefined && wire.slot !== null', to: 'typeof wire.slot === "number"' },
  { file: 'pokemon.ts', from: 'asId(wire.heldItemId) !== null,', to: 'true,' },
  { file: 'state.ts', from: 'return active === null ? null : active === id;', to: 'return active === null ? false : active === id;' },
  { file: 'state.ts', from: 'return this.pokemon(id)?.inTeam ?? null;', to: 'return this.pokemon(id)?.inTeam ?? false;' },
  { file: 'state.ts', from: ': null;\n  }\n\n  /** Does this pokémon hold', to: ': false;\n  }\n\n  /** Does this pokémon hold' },
  { file: 'state.ts', from: '|| !pokemon.heldItemKnown) return null;', to: ') return null;' },
  { file: 'state.ts', from: 'pokemon.heldItemId === this.xpShareId', to: 'pokemon.heldItemId !== this.xpShareId' },
  { file: 'state.ts', from: '    this.pokemonCache = null;\n', to: '' },
  { file: 'state.ts', from: '    this.playerCache = null;\n', to: '' },
  // pricing
  { file: 'pricing.ts', from: 'ball.priceGold <= 0', to: 'ball.priceGold < 0' },
  { file: 'pricing.ts', from: 'offered.price <= 0', to: 'offered.price < 0' },
  // confirmations
  { file: 'confirmations.ts', from: 'after - inventoryBefore < request.quantity', to: 'after - inventoryBefore <= 0' },
  { file: 'confirmations.ts', from: "event['qtd'] !== request.quantity", to: "event['qtd'] === request.quantity" },
  { file: 'confirmations.ts', from: "sameKind === 1 ? 'certain'", to: "sameKind >= 1 ? 'certain'" },
  { file: 'confirmations.ts', from: 'if (graceMs <= 0)', to: 'if (graceMs < 0)' },
  { file: 'confirmations.ts', from: 'sold.name !== wanted', to: 'sold.name === wanted' },
  { file: 'confirmations.ts', from: 'p.level === request.level', to: 'p.level !== request.level' },
  {
    file: 'confirmations.ts',
    from: 'state.pokemon(request.pokemonId) !== undefined',
    to: 'state.pokemon(request.pokemonId) === undefined',
  },
  // actions orchestration
  // asynchronous send: a rejected promise counts as "maybe sent" (the budgets are charged); a refused one is not sent
  { file: 'actions.ts', from: 'sent = true;', to: 'sent = false;' },
  { file: 'actions.ts', from: ': await answer;', to: ': true;' },
  { file: 'actions.ts', from: "typeof answer === 'boolean'", to: "typeof answer !== 'boolean'" },
  { file: 'actions.ts', from: 'this.limiter.recordSend(sentAt);', to: '' },
  { file: 'actions.ts', from: 'this.ledger.record(sentAt, spec.spendGold)', to: 'void 0' },
  { file: 'actions.ts', from: "outcome = { status: 'uncertain', error };", to: "outcome = { status: 'accepted' };" },
  { file: 'actions.ts', from: "notify({ status: 'not-sent' });", to: '' },
  {
    file: 'actions.ts',
    from: 'notify(outcome);\n      const result = await confirmation.result;',
    to: 'const result = await confirmation.result;',
  },
  { file: 'actions.ts', from: "result.status === 'unconfirmed' || result.status === 'rejected'", to: "result.status === 'unconfirmed'" },
  { file: 'actions.ts', from: 'spent + request.totalPrice > cap', to: 'spent + request.totalPrice >= cap' },
  { file: 'actions.ts', from: 'gold < request.totalPrice', to: 'gold <= request.totalPrice' },
  { file: 'actions.ts', from: 'options.confirmIrreversible !== true', to: 'options.confirmIrreversible === false' },
  { file: 'actions-options.ts', from: 'value >= 0', to: 'value > 0' },
  // connection boundary, purchase grace, socket identity, isolation, inspector policy
  { file: 'client.ts', from: 'this.state.markStale();\n          this.emitConnection(false);', to: 'this.emitConnection(false);' },
  { file: 'client.ts', from: 'this.state.markStale();\n          this.emitConnection(true);', to: 'this.emitConnection(true);' },
  { file: 'state.ts', from: 'this.full = false;\n    this.notify();', to: 'this.full = true;\n    this.notify();' },
  { file: 'confirmations.ts', from: 'host.onConnectionChange(() => callback())', to: 'host.onConnectionChange(() => undefined)' },
  { file: 'confirmations.ts', from: "if (byEvent === null) finish({ status: 'rejected'", to: "if (true) finish({ status: 'rejected'" },
  { file: 'confirmations.ts', from: 'if (graceMs <= 0 || count()', to: 'if (graceMs < 0 || count()' },
  { file: 'confirmations.ts', from: '=> byEvent ?? {', to: '=> ({ ...byEvent, x: 0 }) && {' },
  { file: 'page-transport.ts', from: 'if (current() && typeof event.data', to: 'if (typeof event.data' },
  { file: 'page-transport.ts', from: "'close', () => current() && each", to: "'close', () => each" },
  { file: 'page-transport.ts', from: 'if (!adopted.has(this) && !followsLiveSocket) {', to: 'if (hook.socket !== this) {' },
  { file: 'page-transport.ts', from: 'if (!adopted.has(this) && !followsLiveSocket) {', to: 'if (!adopted.has(this)) {' },
  { file: 'page-transport.ts', from: "'open', () => current() && each", to: "'open', () => each" },
  { file: 'state.ts', from: '      this.markStale();\n      throw error;', to: '      throw error;' },
  { file: 'page-transport.ts', from: 'if (hook.socket === this && typeof data', to: 'if (typeof data' },
  { file: 'inspector.ts', from: 'this.applyEventPolicy(packet, sample);', to: '' },
  { file: 'inspector.ts', from: "this.countsOnly = mode === 'counts-only';", to: 'this.countsOnly = false;' },
  { file: 'inspector.ts', from: 'const type = this.countsOnly && !known ? UNKNOWN : rawType;', to: 'const type = rawType;' },
  { file: 'inspector.ts', from: 'KNOWN_EVENTS.has(rawKind) ? rawKind : UNKNOWN', to: 'rawKind' },
  {
    file: 'inspector.ts',
    from: "const key = this.countsOnly && reason !== 'oversized' && reason !== 'not-a-packet' ? UNKNOWN : reason;",
    to: 'const key = reason;',
  },
  { file: 'state.ts', from: 'deepFreeze(structuredClone(value))', to: 'deepFreeze(value)' },
  { file: 'state.ts', from: 'frozenCopy(safeCopy(partial))', to: 'safeCopy(partial)' },
  { file: 'actions.ts', from: 'this.inventoryFloors.clear();', to: '' },
  { file: 'actions.ts', from: 'this.inventoryFloors.get(key) ?? before', to: 'before' },
  { file: 'client.ts', from: 'this.started && this.run === run', to: 'this.started' },
  // errors
  { file: 'errors.ts', from: 'defaultErrorHandler(error);\n  }\n}', to: 'throw error;\n  }\n}' },
];

/**
 * Mutations the tests are EXPECTED to survive, with the reason. Empty today: add one only when you have proven the mutated
 * code is equivalent to the original (not when a test is merely missing).
 */
export const EXPECTED_SURVIVORS = [];
