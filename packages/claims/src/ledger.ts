// 受け取り台帳（追記のみ）と Grant の計画（spec/30）。すべて純関数。
import type { Grant, SimTime } from '@ph/core';
import { addDays, dayNumber, weekOf } from './day.ts';
import { tiered, type ClaimRules, type Source } from './rules.ts';

/** 記録の種類（distance は表示・実績用で報酬 0、rest は休養日パス）。 */
export type Kind = 'steps' | 'distance' | 'checkin' | 'self' | 'rest';

/** 台帳の1行（IndexedDB `claims` store に追記する）。 */
export interface ClaimRecord {
  readonly claimId: string;
  readonly receivedAt: SimTime;
  readonly source: Source;
  readonly kind: Kind;
  /** 端末のローカル日付 YYYY-MM-DD。 */
  readonly day: string;
  /** steps/distance は日の累計値、checkin は分、self は 1、rest は 0。 */
  readonly amount: number;
  readonly span?: readonly [SimTime, SimTime] | undefined;
  readonly trust: number;
  readonly grant: Grant;
}

/** ヘルスケアの1日分（累計値）。 */
export interface HealthDay {
  readonly day: string;
  readonly steps: number;
  readonly distanceM?: number | undefined;
}

/** ショートカットの受け取りコード（parseShortcutCode の結果, spec/31）。 */
export interface ParsedHealth {
  readonly k: 'health';
  readonly receivedAt: SimTime;
  /** 端末の今日（受け取れる日の基準）。 */
  readonly today: string;
  readonly days: readonly HealthDay[];
  /** 検証で捨てた項目の説明（確認画面に出す）。 */
  readonly warnings?: readonly string[] | undefined;
}

/** チェックインの成立結果（spec/32）。 */
export interface CheckinResult {
  readonly k: 'checkin';
  readonly receivedAt: SimTime;
  readonly today: string;
  readonly sessionId: string;
  readonly day: string;
  /** 自分で登録した地点なら true（trust が下がる）。 */
  readonly own: boolean;
  readonly minutes: number;
  readonly span: readonly [SimTime, SimTime];
}

/** 自己申告1件。 */
export interface SelfReport {
  readonly k: 'self';
  readonly receivedAt: SimTime;
  readonly today: string;
  readonly day: string;
}

export type ClaimInput = ParsedHealth | CheckinResult | SelfReport;

const MIN_MS = 60000;

function fail(message: string): never {
  throw new Error('invalid claim input: ' + message);
}

function checkCount(v: number, what: string): void {
  if (!Number.isFinite(v) || v < 0 || Math.floor(v) !== v) {
    fail(what + ' must be a non-negative integer');
  }
}

/** today 基準で受け取れる日か（未来と claimDays より古い日は不可）。 */
function claimable(day: string, today: string, rules: ClaimRules): boolean {
  const d = dayNumber(day);
  const t = dayNumber(today);
  if (d === null || t === null) {
    return false;
  }
  return d <= t && d > t - rules.claimDays;
}

function maxAmount(ledger: readonly ClaimRecord[], kind: Kind, day: string): number {
  let m = 0;
  for (const r of ledger) {
    if (r.kind === kind && r.day === day && r.amount > m) {
      m = r.amount;
    }
  }
  return m;
}

function sumAmount(ledger: readonly ClaimRecord[], kind: Kind, day: string): number {
  let s = 0;
  for (const r of ledger) {
    if (r.kind === kind && r.day === day) {
      s = s + r.amount;
    }
  }
  return s;
}

function count(ledger: readonly ClaimRecord[], pred: (r: ClaimRecord) => boolean): number {
  let n = 0;
  for (const r of ledger) {
    if (pred(r)) {
      n = n + 1;
    }
  }
  return n;
}

/** 行動で連続日数の条件を満たした日か（休養日は含まない。self は数えない）。 */
function achievedReal(ledger: readonly ClaimRecord[], day: string, rules: ClaimRules): boolean {
  return (
    maxAmount(ledger, 'steps', day) >= rules.streak.minSteps ||
    sumAmount(ledger, 'checkin', day) >= rules.streak.minMinutes
  );
}

function hasRest(ledger: readonly ClaimRecord[], day: string): boolean {
  return count(ledger, (r) => r.kind === 'rest' && r.day === day) > 0;
}

function restUsedInWeek(ledger: readonly ClaimRecord[], day: string): boolean {
  const w = weekOf(day);
  return count(ledger, (r) => r.kind === 'rest' && weekOf(r.day) === w) > 0;
}

/** gap 日を休養日パスで埋められるか（前日が行動で達成・その週のパスが未使用）。 */
function restCoverable(ledger: readonly ClaimRecord[], gap: string, rules: ClaimRules): boolean {
  return (
    !achievedReal(ledger, gap, rules) &&
    !hasRest(ledger, gap) &&
    achievedReal(ledger, addDays(gap, -1), rules) &&
    !restUsedInWeek(ledger, gap)
  );
}

function nextId(ledger: readonly ClaimRecord[], source: Source, kind: Kind, day: string): string {
  const prefix = source + ':' + kind + ':' + day + ':';
  return prefix + count(ledger, (r) => r.claimId.startsWith(prefix));
}

interface Draft {
  readonly source: Source;
  readonly kind: Kind;
  readonly day: string;
  readonly amount: number;
  readonly fuelMs: number;
  readonly medals: number;
  readonly span?: readonly [SimTime, SimTime] | undefined;
  readonly claimId?: string | undefined;
}

/**
 * 1件の入力から台帳に追記する行を計画する（ledger は変更しない）。
 * 返した行の grant を順に Engine へ渡し、行を台帳へ追記する。空配列なら受け取るものなし。
 */
export function planGrants(ledger: readonly ClaimRecord[], input: ClaimInput, rules: ClaimRules): ClaimRecord[] {
  if (dayNumber(input.today) === null) {
    fail('today');
  }
  const work: ClaimRecord[] = ledger.slice();
  const out: ClaimRecord[] = [];
  const at = input.receivedAt;

  const push = (d: Draft): void => {
    const trust = d.source === 'pass' ? 0 : rules.trust[d.source];
    const wasAchieved = achievedReal(work, d.day, rules);
    const nowAchieved =
      !wasAchieved &&
      ((d.kind === 'steps' && d.amount >= rules.streak.minSteps) ||
        (d.kind === 'checkin' && sumAmount(work, 'checkin', d.day) + d.amount >= rules.streak.minMinutes));
    if (nowAchieved) {
      const gap = addDays(d.day, -1);
      if (restCoverable(work, gap, rules)) {
        add({ source: 'pass', kind: 'rest', day: gap, amount: 0, fuelMs: 0, medals: 0 }, 0, gap);
      }
    }
    add(d, trust, nowAchieved ? d.day : undefined);
  };

  const add = (d: Draft, trust: number, streakDay: string | undefined): void => {
    const claimId = d.claimId ?? nextId(work, d.source, d.kind, d.day);
    const grant: Grant =
      streakDay === undefined
        ? { claimId, at, fuelMs: d.fuelMs, medals: d.medals }
        : { claimId, at, fuelMs: d.fuelMs, medals: d.medals, streakDay };
    const base = { claimId, receivedAt: at, source: d.source, kind: d.kind, day: d.day, amount: d.amount, trust, grant };
    const r: ClaimRecord = d.span === undefined ? base : { ...base, span: d.span };
    work.push(r);
    out.push(r);
  };

  if (input.k === 'health') {
    const trust = rules.trust.health;
    const perStepMs = (rules.steps.fuelMinPer1000 * MIN_MS) / 1000;
    const fuelAt = (steps: number): number => Math.round(tiered(steps, rules.steps.tiers) * perStepMs * trust);
    const days = input.days.slice().sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    for (const h of days) {
      checkCount(h.steps, 'steps');
      if (h.distanceM !== undefined) {
        checkCount(h.distanceM, 'distanceM');
      }
      if (!claimable(h.day, input.today, rules)) {
        continue;
      }
      // 累計値の差分方式: その日の既得最大値を超えた分だけ。減った値は何もしない。
      const prev = maxAmount(work, 'steps', h.day);
      if (h.steps > prev) {
        const medals = prev < rules.steps.medalAt && h.steps >= rules.steps.medalAt ? 1 : 0;
        push({ source: 'health', kind: 'steps', day: h.day, amount: h.steps, fuelMs: fuelAt(h.steps) - fuelAt(prev), medals });
      }
      if (h.distanceM !== undefined && h.distanceM > maxAmount(work, 'distance', h.day)) {
        push({ source: 'health', kind: 'distance', day: h.day, amount: h.distanceM, fuelMs: 0, medals: 0 });
      }
    }
    return out;
  }

  if (input.k === 'checkin') {
    checkCount(input.minutes, 'minutes');
    if (input.sessionId.length === 0) {
      fail('sessionId');
    }
    const claimId = 'checkin:' + input.sessionId;
    if (input.minutes === 0 || !claimable(input.day, input.today, rules) || work.some((r) => r.claimId === claimId)) {
      return out;
    }
    const source: Source = input.own ? 'checkin-own' : 'checkin';
    const trust = rules.trust[source];
    const prev = sumAmount(work, 'checkin', input.day);
    const eq = tiered(prev + input.minutes, rules.checkin.tiers) - tiered(prev, rules.checkin.tiers);
    const fuelMs = Math.round(eq * rules.checkin.fuelMinPerMin * MIN_MS * trust);
    const medalsToday = count(work, (r) => r.kind === 'checkin' && r.day === input.day && r.grant.medals > 0);
    const medals = input.minutes >= rules.checkin.medalMinMinutes && medalsToday < rules.checkin.medalMaxPerDay ? 1 : 0;
    push({ source, kind: 'checkin', day: input.day, amount: input.minutes, fuelMs, medals, span: input.span, claimId });
    return out;
  }

  if (!claimable(input.day, input.today, rules)) {
    return out;
  }
  if (count(work, (r) => r.kind === 'self' && r.day === input.day) >= rules.self.maxPerDay) {
    return out;
  }
  const fuelMs = Math.round(rules.self.fuelMinPerItem * MIN_MS * rules.trust.self);
  push({ source: 'self', kind: 'self', day: input.day, amount: 1, fuelMs, medals: 0 });
  return out;
}

/**
 * today 時点の連続日数（達成日と休養日パスの日を数える。Engine が streakDay から数える値と一致する）。
 * 今日が未達成なら昨日までで数え、昨日がパスで埋まる見込みなら一昨日までで数える。
 */
export function streakOf(ledger: readonly ClaimRecord[], today: string, rules: ClaimRules): number {
  if (dayNumber(today) === null) {
    fail('today');
  }
  const achieved = (d: string): boolean => achievedReal(ledger, d, rules) || hasRest(ledger, d);
  let d = today;
  if (!achieved(d)) {
    d = addDays(today, -1);
    if (!achieved(d)) {
      if (!restCoverable(ledger, d, rules)) {
        return 0;
      }
      d = addDays(d, -1);
    }
  }
  let n = 0;
  while (achieved(d)) {
    n = n + 1;
    d = addDays(d, -1);
  }
  return n;
}
