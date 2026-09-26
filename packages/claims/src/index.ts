import { CORE_VERSION } from '@ph/core';

/** @ph/claims が前提とする Core のスキーマ版数。 */
export const CLAIMS_CORE_VERSION = CORE_VERSION;

export type { ClaimRules, Source, Tier } from './rules.ts';
export { parseClaimRules } from './rules.ts';
export type { CheckinResult, ClaimInput, ClaimRecord, HealthDay, Kind, ParsedHealth, SelfReport } from './ledger.ts';
export { planGrants, streakOf } from './ledger.ts';
export { addDays, dayNumber, dayString, weekOf } from './day.ts';
