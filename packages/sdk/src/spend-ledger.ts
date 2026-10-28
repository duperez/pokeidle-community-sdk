const HOUR_MS = 3_600_000;

/** The estimated gold sent in orders during the last hour. */
export class SpendLedger {
  #entries: Array<{ at: number; gold: number }> = [];

  record(now: number, gold: number): void {
    this.#entries = [...this.#entries.filter((e) => now - e.at < HOUR_MS), { at: now, gold }];
  }

  spentLastHour(now: number): number {
    const since = now - HOUR_MS;
    return this.#entries.filter((e) => e.at > since).reduce((sum, e) => sum + e.gold, 0);
  }
}
