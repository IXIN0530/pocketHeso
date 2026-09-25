import { expect, test } from 'vitest';
import {
  ECON_PROFILES,
  buildEconInputs,
  econDayString,
  exerciseFuelMin,
  formatEcon,
  parseEconArgs,
  runEcon,
  stepsFuelMin,
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
  expect(medals).toBe(7 + 2);
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
  expect(a.medalsActivity).toBe(3);
  expect(a.croonDay).toBe(1);
  expect(last === undefined ? 0 : last.medals).toBeLessThanOrEqual(a.medalsActivity + a.medalsPachinko);
  const text = formatEcon(a, { init: 0.85, full: 1.0 });
  expect(text).toContain('croon on day 1: OK');
  expect(text).toContain('pachinko EV init 0.850 (≈0.85: OK) / all upgrades 1.000 (<=1.02: OK)');
}, 60000);
