/** Iterative so deeply nested JSON cannot overflow the callback stack while freezing. */
export function deepFreeze<T>(value: T): T {
  const pending: unknown[] = [value];
  while (pending.length) {
    const current = pending.pop();
    if (current === null || typeof current !== 'object' || Object.isFrozen(current)) continue;
    Object.freeze(current);
    for (const child of Object.values(current)) pending.push(child);
  }
  return value;
}
