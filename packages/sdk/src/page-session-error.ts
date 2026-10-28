export type PageSessionErrorCode =
  'unsupported-context' | 'incompatible-runtime' | 'configuration-conflict' | 'invalid-options' | 'busy' | 'core-failure';

/** Controlled lifecycle/policy errors. No page data or occupied-slot contents in the message. */
export class PageSessionError extends Error {
  constructor(readonly code: PageSessionErrorCode) {
    super(`PokeIdle page session: ${code}`);
    this.name = 'PageSessionError';
  }
}

/** Internal refusal path, shared by bootstrap, policy validation and consumer guards. */
export function refusePageSession(code: PageSessionErrorCode): never {
  throw new PageSessionError(code);
}
