import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  accuracyVerdict,
  candidates,
  endSession,
  parseYolp,
  registerPlace,
  selfCheckin,
  sessionState,
  startSession,
  type CheckinSession,
  type Fix,
  type OwnPlace,
  type YolpPlace,
} from './checkin.ts';
import { BASE, YOLP_EMPTY, YOLP_ERROR, YOLP_RESPONSE } from './checkin.fixtures.ts';
import { planGrants, streakOf, type ClaimInput, type ClaimRecord } from './ledger.ts';
import { parseClaimRules } from './rules.ts';

const economy = JSON.parse(readFileSync('../../resources/economy/default.json', 'utf8')) as Record<string, unknown>;
const rules = parseClaimRules(economy);
const MIN = 60000;
const T0 = 1790000000000;
const DAY = '2026-09-26';

const at = (dLat: number, dLon: number, accuracyM = 10): Fix => ({ lat: BASE.lat + dLat, lon: BASE.lon + dLon, accuracyM });
const yolp = parseYolp(YOLP_RESPONSE) as YolpPlace[];
const home: OwnPlace = registerPlace('p1', '近所の公園', '公園', at(0, 0, 12));

function apply(ledger: ClaimRecord[], input: ClaimInput): ClaimRecord[] {
  return ledger.concat(planGrants(ledger, input, rules));
}

/** 候補の先頭（または指定の施設）で開始して、minutes 後に fix で終了する。 */
function run(
  sessionId: string,
  pick: string,
  minutes: number,
  end: Fix,
  opts: { own?: OwnPlace[]; yolpEnd?: YolpPlace[] | null; day?: string } = {},
): { s: CheckinSession; o: ReturnType<typeof endSession> } {
  const own = opts.own ?? [home];
  const c = candidates(at(0, 0), own, yolp).find((x) => (x.ref.k === 'own' ? x.ref.placeId : x.ref.gid) === pick);
  if (c === undefined) {
    throw new Error('no candidate ' + pick);
  }
  const day = opts.day ?? DAY;
  const s = startSession(sessionId, c, at(0, 0), T0, day);
  const yolpEnd = opts.yolpEnd === undefined ? yolp : opts.yolpEnd;
  const o = endSession({ session: s, fix: end, own, yolp: yolpEnd, now: T0 + minutes * MIN, today: day }, rules);
  return { s, o };
}

function ok(o: ReturnType<typeof endSession>): ClaimInput {
  if (o.k !== 'ok') {
    throw new Error('not ok: ' + o.k);
  }
  return o.result;
}

describe('YOLP parse', () => {
  test('merges the same Gid, keeps the larger genre radius, drops other genres and broken coords', () => {
    expect(yolp.map((p) => [p.gid, p.genre, p.radiusM, p.name])).toEqual([
      ['gymA', 'スポーツ施設', 120, 'テストフィットネス'],
      ['parkB', '公園', 100, 'テスト公園'],
    ]);
    expect(yolp[0]).toMatchObject({ lat: 35.6804, lon: 139.76 });
    expect(parseYolp(YOLP_EMPTY)).toEqual([]);
    expect(parseYolp(YOLP_ERROR)).toBeNull();
    expect(parseYolp(null)).toBeNull();
    expect(parseYolp({ ResultInfo: {}, Feature: 'x' })).toBeNull();
  });
});

describe('range', () => {
  test('candidates are in range (radius + accuracy) and sorted by distance', () => {
    const list = candidates(at(0, 0), [home], yolp);
    expect(list.map((c) => [c.ref, Math.round(c.distanceM)])).toEqual([
      [{ k: 'own', placeId: 'p1' }, 0],
      [{ k: 'yolp', gid: 'gymA' }, 44],
      [{ k: 'yolp', gid: 'parkB' }, 90],
    ]);
    // 公園の東 約 200m（公園中心から約 110m）: 半径 100m の外、accuracy 15m を足すと内
    expect(candidates(at(0, 0.0022, 5), [], yolp).map((c) => c.name)).toEqual([]);
    expect(candidates(at(0, 0.0022, 15), [], yolp).map((c) => c.name)).toEqual(['テスト公園']);
  });

  test('accuracy > 150m: retry up to 3 times, then give up; never in range', () => {
    expect(accuracyVerdict(at(0, 0, 150), 1)).toBe('usable');
    expect(accuracyVerdict(at(0, 0, 151), 1)).toBe('retry');
    expect(accuracyVerdict(at(0, 0, 151), 3)).toBe('retry');
    expect(accuracyVerdict(at(0, 0, 151), 4)).toBe('give-up');
    expect(candidates(at(0, 0, 151), [home], yolp)).toEqual([]);
    expect(() => registerPlace('p2', 'x', 'x', at(0, 0, 151))).toThrow();
    expect(() => candidates({ lat: Number.NaN, lon: 0, accuracyM: 5 }, [], [])).toThrow();
  });

  test('session keeps no coordinates', () => {
    const { s } = run('s', 'gymA', 30, at(0, 0));
    expect(s).toEqual({ sessionId: 's', place: { k: 'yolp', gid: 'gymA' }, startAt: T0, startAccuracyM: 10, day: DAY });
    expect(home.radiusM).toBe(80);
  });
});

describe('判定表', () => {
  test('成立: same facility in range and ≥ 20 minutes', () => {
    const { o } = run('s1', 'gymA', 45, at(0.0003, 0.0003));
    expect(o).toMatchObject({ k: 'ok', minutes: 45 });
    const r = planGrants([], ok(o), rules);
    expect(r.map((x) => [x.claimId, x.source, x.grant.fuelMs, x.grant.medals, x.grant.streakDay])).toEqual([
      ['checkin:s1', 'checkin', 90 * MIN, 1, DAY],
    ]);
    expect(r[0]?.span).toEqual([T0, T0 + 45 * MIN]);
  });

  test('成立: counted up to 120 minutes, half after 60', () => {
    const { o } = run('s1', 'gymA', 150, at(0, 0));
    const fuel = planGrants([], ok(o), rules)[0]?.grant.fuelMs;
    expect(fuel).toBe((60 + 30) * 2 * MIN);
  });

  test('成立: own place works offline (YOLP failed)', () => {
    const { o } = run('s1', 'p1', 30, at(0, 0), { yolpEnd: null });
    expect(o).toMatchObject({ k: 'ok', result: { own: true, placeId: 'p1' } });
    expect(planGrants([], ok(o), rules)[0]?.source).toBe('checkin-own');
  });

  test('20分未満: no reward', () => {
    expect(run('s1', 'gymA', 19, at(0, 0)).o).toEqual({ k: 'short', minutes: 19 });
    expect(run('s1', 'gymA', 20, at(0, 0)).o.k).toBe('ok');
  });

  test('範囲外: outside, deleted place, YOLP failure, poor accuracy', () => {
    expect(run('s1', 'gymA', 40, at(0.003, 0)).o).toEqual({ k: 'outside', minutes: 40 });
    expect(run('s1', 'p1', 40, at(0, 0), { own: [home] }).o.k).toBe('ok');
    const gone = candidates(at(0, 0), [home], yolp)[0] as ReturnType<typeof candidates>[number];
    const s = startSession('s2', gone, at(0, 0), T0, DAY);
    expect(endSession({ session: s, fix: at(0, 0), own: [], yolp, now: T0 + 40 * MIN, today: DAY }, rules).k).toBe('outside');
    expect(run('s1', 'gymA', 40, at(0, 0), { yolpEnd: null }).o.k).toBe('outside');
    expect(run('s1', 'gymA', 40, at(0, 0), { yolpEnd: [] }).o.k).toBe('outside');
    expect(run('s1', 'gymA', 40, at(0, 0, 400)).o.k).toBe('outside');
  });

  test('範囲外 → 自己申告: trust 0.3, ≤ elapsed and ≤ 60 minutes, no medal, no streak', () => {
    const { s, o } = run('s1', 'gymA', 90, at(0.003, 0));
    expect(o.k).toBe('outside');
    const now = T0 + 90 * MIN;
    const input = selfCheckin(s, 90, now, DAY, rules);
    expect(input).toMatchObject({ selfReported: true, minutes: 60, span: [T0, T0 + 60 * MIN] });
    let ledger = apply([], input as ClaimInput);
    expect(ledger.map((x) => [x.claimId, x.source, x.trust, x.amount, x.grant.fuelMs, x.grant.medals, x.grant.streakDay])).toEqual([
      ['checkin:s1', 'self', 0.3, 60, Math.round(60 * 2 * MIN * 0.3), 0, undefined],
    ]);
    expect(streakOf(ledger, DAY, rules)).toBe(0);
    // 同じセッションは二重に受け取れない
    expect(planGrants(ledger, input as ClaimInput, rules)).toEqual([]);
    // 30分で施設外 → 45分と申告しても 30分
    const short = run('s2', 'gymA', 30, at(0.003, 0));
    expect(selfCheckin(short.s, 45, T0 + 30 * MIN, DAY, rules)?.minutes).toBe(30);
    expect(selfCheckin(short.s, 0, T0 + 30 * MIN, DAY, rules)).toBeNull();
    // 自己申告の分も日の逓減に合算する: 60分使った後の本物の30分は半分
    ledger = apply(ledger, ok(run('s3', 'gymA', 30, at(0, 0)).o));
    expect(ledger[1]?.grant.fuelMs).toBe(30 * MIN);
    expect(ledger[1]?.grant.streakDay).toBe(DAY);
  });

  test('失効: 3 hours without end; 終了し忘れ is self-reported up to 60 minutes', () => {
    const { s, o } = run('s1', 'gymA', 180, at(0, 0));
    expect(o).toEqual({ k: 'expired' });
    expect(sessionState(s, T0 + 180 * MIN - 1)).toBe('open');
    expect(sessionState(s, T0 + 180 * MIN)).toBe('expired');
    expect(run('s1', 'gymA', 179, at(0, 0)).o.k).toBe('ok');
    const input = selfCheckin(s, 120, T0 + 10 * 60 * MIN, DAY, rules);
    expect(input?.minutes).toBe(60);
    const r = planGrants([], input as ClaimInput, rules);
    expect(r[0]).toMatchObject({ source: 'self', grant: { medals: 0 } });
  });

  test('登録地点の初成立: +1 medal once per place, once per day (carried over)', () => {
    const b: OwnPlace = registerPlace('p2', 'ジム', 'ジム', at(0.0001, 0));
    const own = [home, b];
    const medals = (l: readonly ClaimRecord[]): [number, string | undefined][] =>
      l.map((x) => [x.grant.medals, x.placeBonus]);
    let ledger = apply([], ok(run('a1', 'p1', 30, at(0, 0), { own }).o));
    expect(medals(ledger)).toEqual([[2, 'p1']]);
    // 同じ地点の2回目は通常のメダルだけ
    ledger = apply(ledger, ok(run('a2', 'p1', 30, at(0, 0), { own }).o));
    // 別の登録地点でも同じ日は出ない（通常のメダルは1日2つで打ち止め）
    ledger = apply(ledger, ok(run('a3', 'p2', 30, at(0, 0), { own }).o));
    expect(medals(ledger)).toEqual([
      [2, 'p1'],
      [1, undefined],
      [0, undefined],
    ]);
    // 翌日: p2 の初成立ボーナスが出る。p1 はもう出ない
    const next = '2026-09-27';
    ledger = apply(ledger, ok(run('a4', 'p1', 30, at(0, 0), { own, day: next }).o));
    ledger = apply(ledger, ok(run('a5', 'p2', 30, at(0, 0), { own, day: next }).o));
    expect(medals(ledger.slice(3))).toEqual([
      [1, undefined],
      [2, 'p2'],
    ]);
    // YOLP 施設・自己申告には出ない
    const y = apply([], ok(run('y1', 'parkB', 30, at(0, 0.001)).o));
    expect(medals(y)).toEqual([[1, undefined]]);
    const out = run('z1', 'p1', 30, at(0.003, 0), { own: [home] });
    expect(medals(apply([], selfCheckin(out.s, 30, T0 + 30 * MIN, DAY, rules) as ClaimInput))).toEqual([[0, undefined]]);
  });

  // 「後からボーナス」（ワークアウトとの重なりで checkin-bonus）は D-022 で廃止。判定表に行は無い。
});
