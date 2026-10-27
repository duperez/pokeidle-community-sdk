import { asId, asNumber, isObject } from './coerce.js';

/** Selected automation consumables. A missing or unreadable list is unknown, not an empty selection. */
export interface AutomationState {
  readonly ballIds: readonly number[] | null;
  readonly reviveIds: readonly number[] | null;
  readonly potionIds: readonly number[] | null;
}

export interface TwitchChannel {
  readonly login: string;
  readonly nome: string | null;
  readonly bonus: boolean | null;
  readonly espectadores: number | null;
}

/** Normalized facts, retaining the server's Twitch field names without inferring one field from another. */
export interface TwitchState {
  readonly login: string | null;
  readonly aoVivo: boolean | null;
  readonly assistindo: boolean | null;
  readonly emLives: number | null;
  readonly assistindoEm: readonly string[] | null;
  readonly pct: number | null;
  readonly extra: number | null;
  readonly pctAtual: number | null;
  readonly canal: string | null;
  readonly oficiais: readonly TwitchChannel[] | null;
  readonly lives: readonly TwitchChannel[] | null;
}

const booleanOf = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);
const numberOf = (value: unknown): number | null =>
  typeof value === 'string' && value.trim() !== '' ? asNumber(Number(value)) : asNumber(value);
const textOf = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
};

function idsOf(value: unknown): readonly number[] | null {
  if (!Array.isArray(value)) return null;
  return Object.freeze([...new Set(value.map(asId))].filter((id): id is number => id !== null && Number.isSafeInteger(id) && id > 0));
}

export function normalizeAutomation(value: unknown): AutomationState | null {
  if (!isObject(value)) return null;
  return Object.freeze({
    ballIds: idsOf(value['ballIds']),
    reviveIds: idsOf(value['reviveIds']),
    potionIds: idsOf(value['potionIds']),
  });
}

function channelsOf(value: unknown): readonly TwitchChannel[] | null {
  if (!Array.isArray(value)) return null;
  return Object.freeze(
    value.filter(isObject).flatMap((channel) => {
      const login = textOf(channel['login']);
      return login === null
        ? []
        : [
            Object.freeze({
              login,
              nome: textOf(channel['nome']),
              bonus: booleanOf(channel['bonus']),
              espectadores: numberOf(channel['espectadores']),
            }),
          ];
    }),
  );
}

export function normalizeTwitch(value: unknown): TwitchState | null {
  if (!isObject(value)) return null;
  const watching = value['assistindoEm'];
  return Object.freeze({
    login: textOf(value['login']),
    aoVivo: booleanOf(value['aoVivo']),
    assistindo: booleanOf(value['assistindo']),
    emLives: numberOf(value['emLives']),
    assistindoEm: Array.isArray(watching)
      ? Object.freeze(watching.flatMap((entry: unknown) => textOf(isObject(entry) ? entry['login'] : entry) ?? []))
      : null,
    pct: numberOf(value['pct']),
    extra: numberOf(value['extra']),
    pctAtual: numberOf(value['pctAtual']),
    canal: textOf(value['canal']),
    oficiais: channelsOf(value['oficiais']),
    lives: channelsOf(value['lives']),
  });
}
