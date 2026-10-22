import type { EngineSimEvent, HoldEntry, JackpotKind, LotteryMode } from '@ph/core';
import { expect, test } from 'vitest';
import packJson from '../../../../resources/packs/default/pack.json';
import { planUpperRush } from '@ph/fx';
import { machineRound } from '../engine/game-config.ts';
import { DEFAULT_ROUND, HUD_RESULT_MS, HUD_START_MS, jackpotHud, resultCue, type HudView } from './jackpot-hud.ts';
import { LcdTimeline, applyLcdEvent, stateFromProjection, type LcdState } from './lcd-timeline.ts';

const R = DEFAULT_ROUND;
const EMPTY: LcdState = { holds: [], spin: null, resolved: null, jackpot: null };

const hold = (serial: number, rate?: number, unit?: number): HoldEntry =>
  ({ serial, modeAtDraw: 'normal', isHit: true, branchIndex: 0, patternIndex: 0, color: 'white', hot: 0, hesoPayoutBalls: 3, rate, unit }) as HoldEntry;

type Ev = Parameters<typeof applyLcdEvent>[1];
const run = (s: LcdState, events: readonly Ev[]) => events.reduce(applyLcdEvent, s);

/** 保留1つの当たり → 大当たり → 終わり（next があればモード変更）。 */
function hitAndEnd(serial: number, at: number, kind: JackpotKind, rounds: number, payout: number, next?: { to: LotteryMode; spins: number }): Ev[] {
  const end = at + 5000 + rounds * R.msPerRound;
  const out: Ev[] = [
    { k: 'holdAdded', entry: hold(serial), at },
    { k: 'spinStarted', entry: serial, at, pattern: 'normal_short', endsAt: at + 5000 },
    { k: 'spinResolved', entry: serial, at: at + 5000, hit: true },
    { k: 'jackpotStarted', entry: serial, at: at + 5000, kind, rounds },
    { k: 'jackpotEnded', entry: serial, at: end, payout },
  ];
  if (next) out.push({ k: 'modeChanged', to: next.to, at: end, stRemaining: next.spins });
  return out;
}

test('ラウンド: 始めは「大当たり」、アタッカーの玉と獲得出玉はラウンドの8割で数え上がる・レートを掛ける', () => {
  let s = run(EMPTY, [
    { k: 'holdAdded', entry: hold(1, 4), at: 0 },
    { k: 'spinStarted', entry: 1, at: 0, pattern: 'normal_short', endsAt: 5000 },
    { k: 'spinResolved', entry: 1, at: 5000, hit: true },
    { k: 'jackpotStarted', entry: 1, at: 5000, kind: 'kakuhen', rounds: 10 },
  ]);
  const at = (ms: number) => jackpotHud(s, 5000 + ms, R)!;
  expect(at(0)).toMatchObject({ k: 'round', round: 1, rounds: 10, inRound: 0, balls: 0, chain: 0 });
  expect(at(0).t).toBeLessThan(HUD_START_MS);
  // 1ラウンド = 5秒、玉は 4秒で10個（0.4秒に1個）。「大当たり」の告知中も裏で数える。
  expect(at(2000)).toMatchObject({ round: 1, inRound: 5, balls: 5 * 15 * 4 });
  expect(at(4800)).toMatchObject({ round: 1, inRound: 10, balls: 10 * 15 * 4 });
  expect(at(5000)).toMatchObject({ round: 2, inRound: 0, balls: 10 * 15 * 4 });
  // 最後のラウンドの後（表示の遅れ）でも全ラウンド分で止まる。
  expect(at(10 * 5000 + 3000)).toMatchObject({ round: 10, inRound: 10, balls: 100 * 15 * 4 });
  s = applyLcdEvent(s, { k: 'uwanose', entry: 1, at: 5000 + 50000, addRounds: 10, totalRounds: 20 });
  expect(jackpotHud(s, 5000 + 51000, R)).toMatchObject({ round: 11, rounds: 20, bonus: { add: 10, t: 1000 } });
});

test('ラウンド・結果: 出玉は取得時の unit（D-090、ボーナスなし）', () => {
  let s = run(EMPTY, [
    { k: 'holdAdded', entry: hold(1, 1, 8), at: 0 },
    { k: 'spinStarted', entry: 1, at: 0, pattern: 'normal_short', endsAt: 5000 },
    { k: 'spinResolved', entry: 1, at: 5000, hit: true },
    { k: 'jackpotStarted', entry: 1, at: 5000, kind: 'kakuhen', rounds: 10 },
  ]);
  const at = (ms: number) => jackpotHud(s, 5000 + ms, R)!;
  expect(at(2000)).toMatchObject({ round: 1, inRound: 5, balls: 5 * 15 * 8 });
  expect(at(5000)).toMatchObject({ round: 2, inRound: 0, balls: 10 * 15 * 8 });
  expect(at(10 * 5000 + 3000)).toMatchObject({ round: 10, inRound: 10, balls: 100 * 15 * 8 });
  s = run(s, [{ k: 'jackpotEnded', entry: 1, at: 5000 + 50000, payout: 1500 * 8 } as never]);
  expect(jackpotHud(s, 5000 + 50000 + 100, R)).toMatchObject({ k: 'result', payout: 12000, balls: 0 });
  s = run(s, [{ k: 'modeChanged', to: 'st', at: 5000 + 50000, stRemaining: 100 } as never]);
  expect(jackpotHud(s, 5000 + 50000 + 100, R)).toMatchObject({
    k: 'result',
    kind: 'rushIn',
    payout: 12000,
    chain: 1,
    balls: 12000,
  });
});

test('結果: RUSH 突入 → 継続（連チャン・出玉の合計）→ 回数切れで RUSH 終了', () => {
  let s = run(EMPTY, hitAndEnd(1, 0, 'kakuhen', 10, 1500, { to: 'st', spins: 100 }));
  const end1 = 5000 + 50000;
  expect(s.rush).toEqual({ mode: 'st', chain: 1, balls: 1500 });
  expect(jackpotHud(s, end1 + 100, R)).toMatchObject({ k: 'result', kind: 'rushIn', spins: 100, payout: 1500 });
  expect(jackpotHud(s, end1 + HUD_RESULT_MS, R)).toBeNull();
  // RUSH 中の当たり: 大当たり中は「RUSH 2連目」。
  const t2 = end1 + 60000;
  s = run(s, hitAndEnd(2, t2, 'kakuhen', 10, 1500, { to: 'st', spins: 100 }).slice(0, 4));
  expect(jackpotHud(s, t2 + 6000, R)).toMatchObject({ k: 'round', chain: 2 });
  s = run(s, hitAndEnd(2, t2, 'kakuhen', 10, 1500, { to: 'st', spins: 100 }).slice(4));
  expect(jackpotHud(s, t2 + 5000 + 50000, R)).toMatchObject({ k: 'result', kind: 'rushOn', chain: 2, balls: 3000 });
  // 100回ハズレて通常へ。
  const t3 = t2 + 400000;
  s = applyLcdEvent(s, { k: 'modeChanged', to: 'normal', at: t3, stRemaining: 0 });
  expect(jackpotHud(s, t3, R)).toMatchObject({ k: 'result', kind: 'rushEnd', chain: 2, balls: 3000, payout: 0 });
  expect(s.rush).toEqual({ mode: 'normal', chain: 0, balls: 0 });
});

test('結果: RUSH 中の通常大当たりで終了・通常の通常大当たり（モード変更なし）・時短・LT', () => {
  const rush: LcdState = { ...EMPTY, rush: { mode: 'st', chain: 3, balls: 4500 } };
  const endAt = 5000 + 4 * R.msPerRound;
  let s = run(rush, hitAndEnd(1, 0, 'tsujo', 4, 600, { to: 'normal', spins: 0 }));
  expect(jackpotHud(s, endAt, R)).toMatchObject({ kind: 'rushEnd', chain: 4, balls: 5100, payout: 600 });
  // 通常 → 通常はモード変更が来ない。
  s = run(EMPTY, hitAndEnd(1, 0, 'tsujo', 4, 600));
  expect(jackpotHud(s, endAt, R)).toMatchObject({ kind: 'end', payout: 600 });
  s = run(EMPTY, hitAndEnd(1, 0, 'tsujo', 4, 600, { to: 'jitan', spins: 100 }));
  expect(jackpotHud(s, endAt, R)).toMatchObject({ kind: 'jitanIn', spins: 100 });
  // 時短からの当たりで RUSH、ST から LT へ上がると LT 突入。
  s = run({ ...EMPTY, rush: { mode: 'jitan', chain: 0, balls: 0 } }, hitAndEnd(1, 0, 'kakuhen', 10, 1500, { to: 'st', spins: 56 }));
  expect(s.result).toMatchObject({ kind: 'rushIn', chain: 1 });
  s = run(rush, hitAndEnd(1, 0, 'kakuhen', 10, 1500, { to: 'lt', spins: 91 }));
  expect(s.result).toMatchObject({ kind: 'ltIn', chain: 4, spins: 91 });
});

test('Projection から作った大当たりは終了予定から逆算、連チャンは Core の chain + 1（大当たり中はその次の連目）', () => {
  const s = stateFromProjection({
    holds: [],
    mode: 'st',
    chain: 2,
    chainBalls: 3000,
    jackpot: { entry: 9, kind: 'kakuhen', rounds: 10, endsAt: 1_000_000 },
  } as never);
  expect(jackpotHud(s, 1_000_000 - 3 * R.msPerRound + 1000, R)).toMatchObject({ k: 'round', round: 8, chain: 4 });
});

test('Projection の上乗せ前（LT）は基本ラウンドだけ見せ、未告知の上乗せ込みの終了予定から開始を逆算する', () => {
  // 基本10R＋未告知10R。終了予定は20R分先。開始から3R目の途中。
  const startAt = 1_000_000;
  const endsAt = startAt + 20 * R.msPerRound;
  let s = stateFromProjection({
    holds: [],
    mode: 'lt',
    chain: 1,
    chainBalls: 0,
    jackpot: { entry: 9, kind: 'kakuhen', rounds: 10, hiddenRounds: 10, endsAt },
  } as never);
  const t = startAt + 2 * R.msPerRound + 1000;
  expect(jackpotHud(s, t, R)).toMatchObject({ k: 'round', round: 3, rounds: 10, bonus: null });
  // 告知が来たら合計へ（開始の逆算は変わらない）。
  const uwAt = startAt + 10 * R.msPerRound;
  s = applyLcdEvent(s, { k: 'uwanose', entry: 9, at: uwAt, addRounds: 10, totalRounds: 20 } as Ev);
  expect(jackpotHud(s, uwAt + 1000, R)).toMatchObject({ k: 'round', round: 11, rounds: 20, bonus: { add: 10, t: 1000 } });
});

test('Timeline: 大当たりのイベントとモード変更が表示時刻で届き、Projection と合う', () => {
  const tl = new LcdTimeline();
  const proj = (over: object) => ({ holds: [], mode: 'normal', chain: 0, chainBalls: 0, ...over }) as never;
  tl.push(proj({}), []);
  const events = hitAndEnd(1, 1000, 'kakuhen', 3, 450, { to: 'st', spins: 100 }) as EngineSimEvent[];
  tl.push(proj({ mode: 'st', chain: 0 }), events);
  expect(tl.resyncs).toBe(0);
  const end = 1000 + 5000 + 3 * R.msPerRound;
  expect(jackpotHud(tl.advance(end - 1), end - 1, R)).toMatchObject({ k: 'round', round: 3 });
  expect(jackpotHud(tl.advance(end), end, R)).toMatchObject({ k: 'result', kind: 'rushIn', spins: 100 });
});

test('パックに大当たり中の表示の演出がある', () => {
  const names = packJson.sheets.map((x) => x.pattern);
  for (const k of ['rushIn', 'ltIn', 'rushOn', 'rushEnd', 'jitanIn', 'end'] as const) expect(names).toContain(resultCue(k));
  expect(names).toContain('round');
  expect(names).toContain('uwanose');
});

// 上位RUSH・上乗せ（P15-T3, D-120）。国道店の round と上位の枝。
const RU = machineRound('rush-middle-01')!;
const SEED = 5;
const IN_ST: LcdState = { ...EMPTY, rush: { mode: 'st', chain: 2, balls: 3000 } };

/** ST 中の当たり（上位なら loops 付き）を時刻 0 に始める。 */
function stJackpot(serial: number, upper: number | null, base: LcdState = IN_ST): LcdState {
  return run(base, [
    { k: 'holdAdded', entry: hold(serial), at: -5000 },
    { k: 'spinStarted', entry: serial, at: -5000, pattern: 'normal_short', endsAt: 0 },
    { k: 'spinResolved', entry: serial, at: 0, hit: true },
    upper === null
      ? { k: 'jackpotStarted', entry: serial, at: 0, kind: 'kakuhen', rounds: 10 }
      : { k: 'jackpotStarted', entry: serial, at: 0, kind: 'kakuhen', rounds: 10, bonusRounds: 10 + 10 * upper, upper: true, loops: upper },
  ]);
}
const roundView = (v: HudView | null) => {
  if (v?.k !== 'round') throw new Error('not round');
  return v;
};

test('上位 K = 0: 導入は 10R、白黒の間は HUD が止まり、割れて 20R・「+1,500」、色が戻ると追いつく', () => {
  const s = stJackpot(1, 0);
  expect(s.jackpot).toMatchObject({ rounds: 20, upper: { loops: 0 } });
  const at = (t: number) => roundView(jackpotHud(s, t, RU, SEED));
  expect(at(1000)).toMatchObject({ rounds: 10, upper: { gray: 0, frozen: false } });
  expect(at(4000)).toMatchObject({ round: 1, rounds: 10 });
  // 5,000 でフリーズ（その時の値のまま）。
  expect(at(8000)).toMatchObject({ round: 2, inRound: 0, balls: 150, rounds: 10, upper: { gray: 1, frozen: true, crack: 3 } });
  expect(at(10000)).toMatchObject({ round: 2, inRound: 0, rounds: 20, upper: { banner: { k: 'upperIn', add: 10 }, addBalls: 1500 } });
  expect(at(30000)).toMatchObject({ round: 2, rounds: 20, upper: { banner: { k: 'digit', digit: 0 }, addBalls: 0 } });
  // 36,100 から色が戻り、HUD は実際の値へ。
  expect(at(37000)).toMatchObject({ round: 8, rounds: 20, upper: { gray: 0, frozen: false } });
});

test('上位 K = 4: 上乗せごとに全ラウンド +10、最後は「上乗せ MAX」で 60R', () => {
  const s = stJackpot(2, 4);
  expect(s.jackpot!.rounds).toBe(60);
  const plan = planUpperRush({ serial: 2, st: true, upper: true, loops: 4 }, RU.upper, SEED);
  if (plan.k !== 'upper') throw new Error('not upper');
  expect(plan.max).toBe(true);
  const seen: number[] = [];
  let maxAt = -1;
  for (let t = 0; t < 60 * 5000; t += 100) {
    const v = roundView(jackpotHud(s, t, RU, SEED));
    if (seen.at(-1) !== v.rounds) seen.push(v.rounds);
    if (v.upper?.banner?.k === 'uwanoseMax' && maxAt < 0) maxAt = t;
  }
  expect(seen.slice(0, 6)).toEqual([10, 20, 30, 40, 50, 60]);
  expect(maxAt).toBeGreaterThan(0);
});

test('上位: どの K・seed でも見せる全ラウンドは今のラウンドより先（最後のラウンドを除く）', () => {
  for (let k = 0; k <= 4; k++) {
    for (let serial = 10; serial < 30; serial++) {
      const s = stJackpot(serial, k);
      const total = 20 + 10 * k;
      for (let t = 0; t < total * 5000; t += 250) {
        const live = Math.floor(t / 5000) + 1;
        const v = roundView(jackpotHud(s, t, RU, SEED));
        expect(v.rounds).toBeGreaterThanOrEqual(Math.min(total, live + 1));
        expect(v.rounds).toBeLessThanOrEqual(total);
      }
      // 終わりでは全部。
      expect(roundView(jackpotHud(s, total * 5000 - 1, RU, SEED)).rounds).toBe(total);
    }
  }
  // ラウンドが短い（Debug）: 縮めても全ラウンドは先を見せる。
  const fast = { ...RU, msPerRound: 1000 };
  const s = stJackpot(3, 4);
  for (let t = 0; t < 60000; t += 50) {
    const v = roundView(jackpotHud(s, t, fast, SEED));
    expect(v.rounds).toBeGreaterThanOrEqual(Math.min(60, Math.floor(t / 1000) + 2));
  }
});

test('ガセ: RUSH 中の上位でない当たりの一部で白黒・フリーズして割れずに戻る、初当たり・light・lt には出ない', () => {
  let serial = 100;
  while (planUpperRush({ serial, st: true, upper: false, loops: 0 }, RU.upper, SEED).k !== 'gase') serial++;
  const s = stJackpot(serial, null);
  const at = (t: number) => roundView(jackpotHud(s, t, RU, SEED));
  expect(at(6000)).toMatchObject({ round: 2, inRound: 0, rounds: 10, upper: { gray: 1, frozen: true, crack: 0, banner: null } });
  expect(at(8000)).toMatchObject({ round: 2, inRound: 7, upper: { gray: 0, frozen: false } });
  // 同じ当たりでも初当たり（通常中）・上位の枝の無い機種では何も出ない。
  const first = stJackpot(serial, null, EMPTY);
  expect(roundView(jackpotHud(first, 6000, RU, SEED)).upper).toBeNull();
  expect(roundView(jackpotHud(s, 6000, machineRound('light-middle-01')!, SEED)).upper).toBeNull();
  expect(roundView(jackpotHud(s, 6000, machineRound('lt-middle-01')!, SEED)).upper).toBeNull();
  expect(roundView(jackpotHud(s, 6000, R, SEED)).upper).toBeNull();
});

test('上位の終わりは「上位RUSH継続」、Projection から作った上位は合計から逆算する', () => {
  let s = stJackpot(4, 1);
  s = run(s, [
    { k: 'jackpotEnded', entry: 4, at: 150000, payout: 4500 } as never,
    { k: 'modeChanged', to: 'st', at: 150000, stRemaining: 66 } as never,
  ]);
  expect(jackpotHud(s, 150100, RU, SEED)).toMatchObject({ k: 'result', kind: 'rushOn', upper: true, chain: 3 });
  const plain = run(stJackpot(5, null), [
    { k: 'jackpotEnded', entry: 5, at: 50000, payout: 1500 } as never,
    { k: 'modeChanged', to: 'st', at: 50000, stRemaining: 66 } as never,
  ]);
  expect(jackpotHud(plain, 50100, RU, SEED)).toMatchObject({ k: 'result', upper: false });
  const p = stateFromProjection({
    holds: [],
    mode: 'st',
    chain: 1,
    chainBalls: 1500,
    jackpot: { entry: 4, kind: 'kakuhen', rounds: 30, endsAt: 150000, upper: true, loops: 1 },
  } as never);
  expect(p.jackpot).toMatchObject({ rounds: 30, upper: { loops: 1 } });
  // 開始は 0。37,000ms は K = 1 の数字の途中（白黒・フリーズ中）。
  expect(jackpotHud(p, 37000, RU, SEED)).toMatchObject({ k: 'round', round: 2, upper: { frozen: true } });
});
