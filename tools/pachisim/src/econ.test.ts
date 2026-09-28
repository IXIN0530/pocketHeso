import { expect, test } from 'vitest';
import {
  ECON_PROFILES,
  buildEconInputs,
  econDayString,
  exerciseFuelMin,
  formatEcon,
  lastRegular,
  parseEconArgs,
  runEcon,
  stepsFuelMin,
  type EconDayRow,
  type EconResult,
} from './econ.ts';

function profile(id: string) {
  const p = ECON_PROFILES.find((x) => x.id === id);
  if (p === undefined) {
    throw new Error('no profile ' + id);
  }
  return p;
}

test('parseEconArgs は --profile/--days 必須・既定は seed1/light/1000h', () => {
  const a = parseEconArgs(['--profile', 'standard', '--days', '30']);
  expect(a.profile.id).toBe('standard');
  expect(a.days).toBe(30);
  expect(a.seed).toBe(1);
  expect(a.machine).toBe('light-middle-01');
  expect(a.evHours).toBe(1000);
  expect(a.json).toBe(false);
  const b = parseEconArgs(['--profile', 'none', '--days', '61', '--seed', '3', '--ev-hours', '0', '--json']);
  expect(b.profile.id).toBe('none');
  expect(b.seed).toBe(3);
  expect(b.evHours).toBe(0);
  expect(b.json).toBe(true);
  expect(() => parseEconArgs(['--days', '30'])).toThrow();
  expect(() => parseEconArgs(['--profile', 'lazy', '--days', '30'])).toThrow();
  expect(() => parseEconArgs(['--profile', 'standard', '--days', '0'])).toThrow();
  expect(() => parseEconArgs(['--profile', 'standard', '--days', '30', '--unknown', '1'])).toThrow();
});

test('歩数・運動の換算は spec/30 の逓減どおり', () => {
  expect(stepsFuelMin(0)).toBe(0);
  expect(stepsFuelMin(8000)).toBe(80);
  expect(stepsFuelMin(10000)).toBe(100);
  expect(stepsFuelMin(12000)).toBe(110);
  expect(stepsFuelMin(15000)).toBe(125);
  expect(stepsFuelMin(30000)).toBe(125);
  expect(exerciseFuelMin(20)).toBe(40);
  expect(exerciseFuelMin(60)).toBe(120);
  expect(exerciseFuelMin(90)).toBe(150);
  expect(exerciseFuelMin(200)).toBe(180);
  expect(econDayString(0)).toBe('2026-10-01');
  expect(econDayString(31)).toBe('2026-11-01');
});

test('standard の1週間は 8,000歩×7日＋ジム2回の燃料・メダル・連日を出す', () => {
  const inputs = buildEconInputs(profile('standard'), 7);
  let fuelMs = 0;
  let medals = 0;
  const streakDays = new Set<string>();
  let prevT = -1;
  for (const i of inputs) {
    expect(i.t).toBeGreaterThanOrEqual(prevT);
    prevT = i.t;
    if (i.grant !== undefined) {
      fuelMs = fuelMs + i.grant.fuelMs;
      medals = medals + i.grant.medals;
      if (i.grant.streakDay !== undefined) {
        streakDays.add(i.grant.streakDay);
      }
    }
  }
  expect(fuelMs).toBe((7 * 80 + 2 * 120) * 60000);
  expect(medals).toBe(7 * 4 + 2 * 6);
  expect(streakDays.size).toBe(7);
  expect(inputs.filter((i) => i.fg === true).length).toBe(7 * 3);
  const none = buildEconInputs(profile('none'), 7);
  expect(none.filter((i) => i.grant !== undefined).length).toBe(0);
  expect(none.filter((i) => i.fg === false).length).toBe(7 * 3);
});

test('runEcon は決定論で、メダル内訳の合計が残高＋覚醒消費と整合する', () => {
  const a = runEcon(profile('standard'), 2, 1, 'light-middle-01');
  const b = runEcon(profile('standard'), 2, 1, 'light-middle-01');
  expect(a).toEqual(b);
  expect(a.rows.length).toBe(2);
  const last = a.rows[1];
  expect(last === undefined ? -1 : last.medalsActivity + last.medalsPachinko).toBe(a.medalsActivity + a.medalsPachinko);
  expect(a.medalsActivity).toBe(14);
  expect(a.croonDay).toBe(1);
  expect(last === undefined ? 0 : last.medals).toBeLessThanOrEqual(a.medalsActivity + a.medalsPachinko);
  const text = formatEcon(a, { init: 0.85, full: 1.0 });
  expect(text).toContain('croon on day 1: OK');
  expect(text).toContain('pachinko EV init 0.850 (≈0.85: OK) / all upgrades 1.000 (<=1.02: OK)');
}, 60000);

test('runEcon 7日: 閉店は獲得≥1のみ・玉内訳が累計と整合・新目標行を出す', () => {
  const r = runEcon(profile('standard'), 7, 1, 'light-middle-01');
  expect(r.closeHistory.length).toBeGreaterThanOrEqual(1);
  for (const c of r.closeHistory) {
    expect(c.gain).toBeGreaterThanOrEqual(1);
    expect(c.day).toBeGreaterThanOrEqual(1);
    expect(c.day).toBeLessThanOrEqual(7);
  }
  const last = r.rows[6] as EconDayRow;
  expect(last.closes).toBe(r.closeHistory.length);
  expect(r.bonus).toBeGreaterThan(0);
  expect(r.action).toBeGreaterThan(0);
  // 役物＋ボーナス＋出玉＋行動 = 全期間累計玉（予告のボーナス等も tick 側に入る）。
  expect((r.yakumono + r.bonus + r.payout + r.action) / last.totalTotal).toBeCloseTo(1, 9);
  const text = formatEcon(r, null);
  expect(text).toMatch(/first gain \+1: OK/);
  expect(text).toMatch(/jackpot share day1-7 25-45%: (OK|NG) \(\d+\.\d%\)/);
  expect(text).toMatch(/action share day1-7 25-45%: (OK|NG) \(\d+\.\d%\)/);
}, 120000);

test('formatEcon: heavy は standard と常連Pを比べ、週次は (最上位役物, Lv合計) の辞書順で上回るかを見る', () => {
  const row = (day: number, top: string, lvTotal: number, regular: number): EconDayRow => ({
    day, balls: 0, perSecFg: day, runTotal: 0, totalTotal: 0, regular, ballPts: 0, medalPts: 0, closes: 0, awakens: 0,
    top, lvTotal, medals: 0, medalsActivity: 0, medalsPachinko: 0, jackpots: 0, fired: 0, payout: 0, yakumono: 0, bonus: 0, action: 0, fuelMin: 0,
  });
  const res = (profileId: string, rows: EconDayRow[]): EconResult => ({
    profile: profileId, machine: 'light-middle-01', seed: 1, days: rows.length, rows, croonDay: 1, firstAwakenDay: 3,
    firstCloseDay: 7, medalsActivity: 0, medalsPachinko: 0, closeHistory: [{ day: 7, gain: 1 }], yakumono: 0, bonus: 0, payout: 0, action: 0,
  });
  const heavy = res('heavy', [row(1, '-', 0, 3)]);
  const std = res('standard', [row(1, '-', 0, 2)]);
  expect(lastRegular(heavy)).toBe(3);
  expect(formatEcon(heavy, null, std)).toContain('heavy regular > standard: OK (3 vs 2)');
  expect(formatEcon(heavy, null, heavy)).toContain('heavy regular > standard: NG (3 vs 3)');
  expect(formatEcon(heavy, null)).toContain('heavy regular > standard: NG (no standard baseline)');
  const weeks = (lv: readonly number[]): EconDayRow[] => {
    const out: EconDayRow[] = [];
    for (let d = 0; d < 28; d = d + 1) {
      const w = Math.floor(d / 7);
      out.push(row(d + 1, w === 0 ? 'denchu' : 'shima', lv[w] as number, 0));
    }
    return out;
  };
  expect(formatEcon(res('standard', weeks([10, 20, 30, 40])), null)).toContain('weekly top increasing: OK');
  expect(formatEcon(res('standard', weeks([10, 20, 30, 30])), null)).toContain('weekly top increasing: NG');
});
