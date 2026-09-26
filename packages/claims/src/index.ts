import { CORE_VERSION } from '@ph/core';

/** @ph/claims が前提とする Core のスキーマ版数。 */
export const CLAIMS_CORE_VERSION = CORE_VERSION;

export type { ClaimRules, Source, Tier } from './rules.ts';
export { parseClaimRules } from './rules.ts';
export type { CheckinResult, ClaimInput, ClaimRecord, HealthDay, Kind, ParsedHealth, SelfReport } from './ledger.ts';
export { planGrants, streakOf } from './ledger.ts';
export type { ClaimError, ClaimErrorCode } from './shortcut-code.ts';
export { parseShortcutCode } from './shortcut-code.ts';
export { addDays, dayNumber, dayString, weekOf } from './day.ts';
export type {
  Candidate,
  CheckinSession,
  EndInput,
  EndOutcome,
  Fix,
  OwnPlace,
  PlaceRef,
  YolpPlace,
} from './checkin.ts';
export {
  accuracyVerdict,
  candidates,
  DEFAULT_OWN_RADIUS_M,
  distanceM,
  endSession,
  EXPIRE_MS,
  inRange,
  MAX_RETRIES,
  parseYolp,
  registerPlace,
  RETRY_ACCURACY_M,
  selfCheckin,
  sessionState,
  startSession,
  YOLP_GENRES,
} from './checkin.ts';
