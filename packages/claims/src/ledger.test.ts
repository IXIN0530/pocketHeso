import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { addDays, dayNumber, dayString, weekOf } from './day.ts';
import { planGrants, streakOf, type ClaimInput, type ClaimRecord } from './ledger.ts';
import { parseClaimRules } from './rules.ts';

const economy = JSON.parse(readFileSync('../../resources/economy/default.json', 'utf8')) as Record<string, unknown>;
const rules = parseClaimRules(economy);
const MIN = 60000;

function apply(ledger: ClaimRecord[], input: ClaimInput): ClaimRecord[] {
  return ledger.concat(planGrants(ledger, input, rules));
}

function health(today: string, days: { day: string; steps: number; distanceM?: number }[], at = 0): ClaimInput {
  return { k: 'health', receivedAt: at, today, days };
}

function checkin(day: string, sessionId: string, minutes: number, own = false): ClaimInput {
  return { k: 'checkin', receivedAt: 0, today: day, sessionId, day, own, minutes, span: [0, minutes * MIN] };
}

function fuelOf(rs: readonly ClaimRecord[]): number {
  return rs.reduce((s, r) => s + r.grant.fuelMs, 0);
}

describe('day', () => {
  test('round trip and leap years', () => {
    expect(dayNumber('1970-01-01')).toBe(0);
    for (const d of ['2024-02-29', '2026-09-26', '2000-03-01', '1999-12-31']) {
      expect(dayString(dayNumber(d) as number)).toBe(d);
    }
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(dayNumber('2026-02-29')).toBeNull();
    expect(dayNumber('2026-9-1')).toBeNull();
  });
  test('week starts on Monday', () => {
    expect(weekOf('2026-09-21')).toBe(weekOf('2026-09-27')); // 月〜日
    expect(weekOf('2026-09-28')).toBe(weekOf('2026-09-27') + 1);
  });
});

describe('rules', () => {
  test('default.json claims', () => {
    expect(rules.claimDays).toBe(3);
    expect(rules.steps.tiers).toEqual([{ to: 10000, mult: 1 }, { to: 15000, mult: 0.5 }]);
    expect(rules.trust['checkin-own']).toBe(0.8);
  });
  test('rejects broken rules', () => {
    const bad = JSON.parse(JSON.stringify(economy)) as Record<string, unknown>;
    ((bad['claims'] as Record<string, unknown>)['steps'] as Record<string, unknown>)['tiers'] = [
      { to: 10000, mult: 1 },
      { to: 5000, mult: 0.5 },
    ];
    expect(() => parseClaimRules(bad)).toThrow(/ascending/);
    const bad2 = JSON.parse(JSON.stringify(economy)) as Record<string, unknown>;
    ((bad2['claims'] as Record<string, unknown>)['trust'] as Record<string, unknown>)['self'] = 2;
    expect(() => parseClaimRules(bad2)).toThrow(/trust.self/);
  });
});

describe('steps', () => {
  test('3000→8000→8000→7000 pays 3000 + 5000 only', () => {
    const today = '2026-09-26';
    let ledger: ClaimRecord[] = [];
    const got: ClaimRecord[][] = [];
    for (const steps of [3000, 8000, 8000, 7000]) {
      const rs = planGrants(ledger, health(today, [{ day: today, steps }]), rules);
      got.push(rs);
      ledger = ledger.concat(rs);
    }
    expect(got.map((rs) => rs.length)).toEqual([1, 1, 0, 0]);
    expect(got[0]?.[0]?.grant.fuelMs).toBe(30 * MIN);
    expect(got[1]?.[0]?.grant.fuelMs).toBe(50 * MIN);
    expect(got[1]?.[0]?.grant.medals).toBe(1); // 8,000歩到達
    expect(fuelOf(ledger)).toBe(80 * MIN);
    expect(ledger.map((r) => r.claimId)).toEqual(['health:steps:2026-09-26:0', 'health:steps:2026-09-26:1']);
  });

  test('taper: half to 15,000, zero beyond; split syncs sum to the same total', () => {
    const today = '2026-09-26';
    const once = planGrants([], health(today, [{ day: today, steps: 20000 }]), rules);
    expect(fuelOf(once)).toBe(125 * MIN);
    let ledger: ClaimRecord[] = [];
    for (const steps of [4321, 9999, 10001, 12345, 14999, 17000]) {
      ledger = apply(ledger, health(today, [{ day: today, steps }]));
    }
    expect(fuelOf(ledger)).toBe(Math.round((10000 + 2500) * 600));
    expect(ledger.reduce((s, r) => s + r.grant.medals, 0)).toBe(1);
  });

  test('only today and the past 2 days', () => {
    const today = '2026-09-26';
    const rs = planGrants(
      [],
      health(today, [
        { day: '2026-09-23', steps: 9000 },
        { day: '2026-09-24', steps: 1000 },
        { day: '2026-09-26', steps: 2000 },
        { day: '2026-09-27', steps: 3000 },
      ]),
      rules,
    );
    expect(rs.map((r) => r.day)).toEqual(['2026-09-24', '2026-09-26']);
  });

  test('distance is recorded without reward', () => {
    const today = '2026-09-26';
    const rs = planGrants([], health(today, [{ day: today, steps: 1000, distanceM: 800 }]), rules);
    expect(rs.map((r) => [r.kind, r.amount, r.grant.fuelMs])).toEqual([
      ['steps', 1000, 10 * MIN],
      ['distance', 800, 0],
    ]);
  });

  test('rejects broken counts', () => {
    expect(() => planGrants([], health('2026-09-26', [{ day: '2026-09-26', steps: -1 }]), rules)).toThrow();
    expect(() => planGrants([], health('2026-09-26', [{ day: '2026-09-26', steps: 1.5 }]), rules)).toThrow();
    expect(() => planGrants([], health('bad', []), rules)).toThrow();
  });
});

describe('checkin', () => {
  test('taper across sessions, own spot trust, duplicate session', () => {
    const day = '2026-09-26';
    let ledger = apply([], checkin(day, 's1', 50));
    expect(ledger[0]?.claimId).toBe('checkin:s1');
    expect(ledger[0]?.grant.fuelMs).toBe(100 * MIN);
    expect(ledger[0]?.span).toEqual([0, 50 * MIN]);
    // 50〜100分: 10分等倍＋40分半分 = 30分相当 ×2 ×0.8
    ledger = apply(ledger, checkin(day, 's2', 50, true));
    expect(ledger[1]?.source).toBe('checkin-own');
    expect(ledger[1]?.grant.fuelMs).toBe(Math.round(60 * MIN * 0.8));
    expect(planGrants(ledger, checkin(day, 's1', 50), rules)).toEqual([]);
    // 120分超は 0（記録は残る）
    ledger = apply(ledger, checkin(day, 's3', 30));
    expect(ledger[2]?.grant.fuelMs).toBe(20 * MIN);
    ledger = apply(ledger, checkin(day, 's4', 30));
    expect(ledger[3]?.grant.fuelMs).toBe(0);
  });

  test('medal per 20min session, 2 per day', () => {
    const day = '2026-09-26';
    let ledger: ClaimRecord[] = [];
    for (const [id, m] of [['a', 19], ['b', 20], ['c', 25], ['d', 40]] as const) {
      ledger = apply(ledger, checkin(day, id, m));
    }
    expect(ledger.map((r) => r.grant.medals)).toEqual([0, 1, 1, 0]);
  });
});

describe('self', () => {
  test('10min × trust 0.3, 5 per day', () => {
    const day = '2026-09-26';
    let ledger: ClaimRecord[] = [];
    for (let i = 0; i < 6; i++) {
      ledger = apply(ledger, { k: 'self', receivedAt: i, today: day, day });
    }
    expect(ledger.length).toBe(5);
    expect(ledger[0]?.grant.fuelMs).toBe(3 * MIN);
    expect(ledger[4]?.claimId).toBe('self:self:2026-09-26:4');
    expect(ledger.every((r) => r.grant.streakDay === undefined)).toBe(true);
  });
});

describe('streak', () => {
  // 2026-09-21 は月曜
  const walk = (ledger: ClaimRecord[], day: string, steps: number): ClaimRecord[] =>
    apply(ledger, health(day, [{ day, steps }]));

  /** Engine（economy-state.applyStreakDay）と同じ数え方で streakDay 列を数える。 */
  function engineCount(ledger: readonly ClaimRecord[]): number {
    let last = '';
    let n = 0;
    for (const r of ledger) {
      const d = r.grant.streakDay;
      if (d === undefined || d === last) {
        continue;
      }
      n = last !== '' && addDays(last, 1) === d ? n + 1 : d > last ? 1 : n;
      last = d > last ? d : last;
    }
    return n;
  }

  test('streakDay only on the grant that reaches 5,000 steps or 20 minutes', () => {
    let ledger = walk([], '2026-09-21', 3000);
    ledger = walk(ledger, '2026-09-21', 6000);
    ledger = walk(ledger, '2026-09-21', 9000);
    expect(ledger.map((r) => r.grant.streakDay)).toEqual([undefined, '2026-09-21', undefined]);
    ledger = apply(ledger, checkin('2026-09-22', 'x', 15));
    ledger = apply(ledger, checkin('2026-09-22', 'y', 5, true));
    expect(ledger.slice(3).map((r) => r.grant.streakDay)).toEqual([undefined, '2026-09-22']);
    ledger = apply(ledger, { k: 'self', receivedAt: 0, today: '2026-09-23', day: '2026-09-23' });
    expect(streakOf(ledger, '2026-09-22', rules)).toBe(2);
    expect(streakOf(ledger, '2026-09-23', rules)).toBe(2); // 今日は未達成（self は数えない）
  });

  test('rest pass covers one missed day per week', () => {
    let ledger = walk([], '2026-09-21', 6000); // 月
    ledger = walk(ledger, '2026-09-22', 6000); // 火
    ledger = walk(ledger, '2026-09-23', 1000); // 水: 未達成
    expect(streakOf(ledger, '2026-09-23', rules)).toBe(2); // 今日はまだ途中
    expect(streakOf(ledger, '2026-09-24', rules)).toBe(2); // 昨日の穴はパスで埋まる見込み
    const thu = planGrants(ledger, health('2026-09-24', [{ day: '2026-09-24', steps: 7000 }]), rules);
    expect(thu.map((r) => [r.claimId, r.grant.fuelMs, r.grant.streakDay])).toEqual([
      ['pass:rest:2026-09-23:0', 0, '2026-09-23'],
      ['health:steps:2026-09-24:0', 70 * MIN, '2026-09-24'],
    ]);
    ledger = ledger.concat(thu);
    expect(streakOf(ledger, '2026-09-24', rules)).toBe(4);
    expect(engineCount(ledger)).toBe(4);
    // 同じ週の2回目の穴（金）はパスなし → 土で 1 から
    expect(streakOf(ledger, '2026-09-26', rules)).toBe(0);
    ledger = walk(ledger, '2026-09-26', 5000);
    expect(ledger.some((r) => r.kind === 'rest' && r.day === '2026-09-25')).toBe(false);
    expect(streakOf(ledger, '2026-09-26', rules)).toBe(1);
    expect(engineCount(ledger)).toBe(1);
    // 翌週はまたパスが使える（月の穴を日→火でつなぐ）
    ledger = walk(ledger, '2026-09-27', 5000);
    ledger = walk(ledger, '2026-09-29', 5000);
    expect(ledger.filter((r) => r.kind === 'rest').map((r) => r.day)).toEqual(['2026-09-23', '2026-09-28']);
    expect(streakOf(ledger, '2026-09-29', rules)).toBe(4);
    expect(engineCount(ledger)).toBe(4);
  });

  test('two missed days in a row break the streak', () => {
    let ledger = walk([], '2026-09-21', 6000);
    ledger = walk(ledger, '2026-09-24', 6000);
    expect(ledger.some((r) => r.kind === 'rest')).toBe(false);
    expect(streakOf(ledger, '2026-09-24', rules)).toBe(1);
    expect(streakOf(ledger, '2026-09-23', rules)).toBe(1); // 火の穴1つはまだパスで埋まる見込み
    expect(engineCount(ledger)).toBe(1);
  });

  test('three days from one shortcut code fill the gap in order', () => {
    const rs = planGrants(
      [],
      health('2026-09-24', [
        { day: '2026-09-24', steps: 8000 },
        { day: '2026-09-22', steps: 6000 },
        { day: '2026-09-23', steps: 2000 },
      ]),
      rules,
    );
    expect(rs.map((r) => [r.kind, r.day, r.grant.streakDay])).toEqual([
      ['steps', '2026-09-22', '2026-09-22'],
      ['steps', '2026-09-23', undefined],
      ['rest', '2026-09-23', '2026-09-23'],
      ['steps', '2026-09-24', '2026-09-24'],
    ]);
    expect(streakOf(rs, '2026-09-24', rules)).toBe(3);
    expect(engineCount(rs)).toBe(3);
  });
});
