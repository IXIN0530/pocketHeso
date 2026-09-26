import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { activeScenes, planSpin, type SpinPlanOptions } from './spin-plan.ts';
import { pack, sheet } from './fx.fixtures.ts';

const patterns = JSON.parse(
  readFileSync(new URL('../../../resources/machines/patterns.json', import.meta.url), 'utf8'),
) as readonly { id: string; ms: number; climax_ms?: number }[];
const patternMs = (id: string) => patterns.find((p) => p.id === id)!.ms;

/** 演出プレビューの4本（spec/43: 通常リーチ / SP / 激アツ / 確定）。 */
const FOUR = ['reach_n', 'sp_reach', 'spsp_gekiatsu', 'kakutei'] as const;

/** 1変動の演出ログ（分岐・液晶シーン・その他キューを時刻付きで1行に）。 */
function logLine(pattern: string, o: SpinPlanOptions): string {
  const p = planSpin(sheet(pattern), o);
  const lcd = p.lcd.map((c) => `${c.at}:${c.scene}${c.text ?? ''}+${c.ms}`).join(',');
  const cues = p.cues.map((c) => `${c.at}:${c.kind}`).join(',');
  return `${pattern}#${o.serial} [${p.picks.join('')}] ${lcd} | ${cues}`;
}

/** 通し番号 → その変動の4本分のログ。 */
function runLog(order: readonly number[], seed: number, shorten: number): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const serial of order) {
    out.set(
      serial,
      FOUR.map((pattern) => {
        const ms = patternMs(pattern);
        return logLine(pattern, { seed, serial, intensity: 2, patternMs: ms, durationMs: Math.round(ms * shorten) });
      }),
    );
  }
  return out;
}

test('same input gives the same presentation branches (random log comparison)', () => {
  const serials = Array.from({ length: 300 }, (_, i) => i * 7919 + 3);
  for (const seed of [1, 0x9e3779b9, 20260927]) {
    for (const shorten of [1, 0.729]) {
      const a = runLog(serials, seed, shorten);
      // 別の seed を挟み、逆順で引き直しても同じ（状態の持ち越しや評価順に依存しない）。
      runLog(serials.slice(0, 20), seed + 1, 1);
      const b = runLog([...serials].reverse(), seed, shorten);
      for (const serial of serials) expect(b.get(serial)).toEqual(a.get(serial));
    }
  }
});

test('branches depend on seed and serial and every option shows up', () => {
  for (const pattern of FOUR) {
    const s = sheet(pattern);
    const seen = s.branches.map(() => new Set<number>());
    const bySeed = new Set<string>();
    for (let serial = 0; serial < 200; serial++) {
      const o = { seed: 42, serial, intensity: 2, patternMs: patternMs(pattern), durationMs: patternMs(pattern) };
      planSpin(s, o).picks.forEach((i, b) => seen[b]!.add(i));
      bySeed.add(planSpin(s, { ...o, seed: 43 }).picks.join('') + '/' + planSpin(s, o).picks.join(''));
    }
    seen.forEach((set, b) => expect(set.size, `${pattern} ${s.branches[b]!.name}`).toBe(s.branches[b]!.options.length));
    expect(bySeed.size).toBeGreaterThan(1);
  }
});

test('the four previews exist and gekiatsu has pseudo-continuation and a group notice', () => {
  for (const pattern of FOUR) expect(pack.sheets.some((s) => s.pattern === pattern)).toBe(true);
  const g = sheet('spsp_gekiatsu');
  const scenes = [...g.cues, ...g.branches.flatMap((b) => b.options.flatMap((o) => o.cues))].map((c) => (c.kind === 'lcd' ? c.scene : ''));
  expect(scenes).toContain('pseudo');
  expect(scenes).toContain('group');
});

test('timing follows the actual spin length (pattern ms and shortened)', () => {
  for (const pattern of FOUR) {
    const ms = patternMs(pattern);
    const climax = patterns.find((p) => p.id === pattern)!.climax_ms;
    for (const k of [1, 0.9, 0.729]) {
      const durationMs = Math.round(ms * k);
      for (let serial = 0; serial < 30; serial++) {
        const p = planSpin(sheet(pattern), { seed: 5, serial, intensity: 3, patternMs: ms, durationMs });
        for (const c of p.lcd) expect(c.at + c.ms).toBeLessThanOrEqual(durationMs);
        for (const c of p.cues) expect(c.at).toBeLessThan(durationMs);
        // 決め（climax）はパターンの climax_ms に合わせて伸縮する。
        const kime = p.lcd.find((c) => c.scene === 'climax' || c.scene === 'kakutei');
        if (climax !== undefined) expect(kime?.at).toBe(Math.round(climax * k));
        // リーチの図柄が揃う時刻が1つ決まる。
        expect(p.lcd.filter((c) => c.scene === 'reach')).toHaveLength(1);
      }
    }
  }
});

test('activeScenes returns scenes running at t in time order', () => {
  const p = planSpin(sheet('sp_reach'), { seed: 1, serial: 1, intensity: 2, patternMs: 45000, durationMs: 45000 });
  expect(activeScenes(p.lcd, 7000).map((s) => s.cue.scene)).toEqual(['reach', 'sp', 'cutin']);
  const sp = activeScenes(p.lcd, 22000).find((s) => s.cue.scene === 'sp')!;
  expect(sp.t).toBe(16000);
  expect(sp.p).toBeCloseTo(0.5);
  expect(activeScenes(p.lcd, 45000)).toEqual([]);
});

test('no sheet means no presentation', () => {
  expect(planSpin(undefined, { seed: 1, serial: 1, intensity: 2, patternMs: 5000, durationMs: 5000 })).toEqual({ picks: [], cues: [], lcd: [] });
});
