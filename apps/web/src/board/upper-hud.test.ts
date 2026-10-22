import { UPPER_CUES } from '@ph/fx';
import { expect, test } from 'vitest';
import { pack } from '../fx/fx-host.ts';
import { PREVIEW_UPPER_SPEC, UPPER_PREVIEWS, gaseSerial, upperPreviewRounds, upperPreviewState, type PreviewRequest } from '../stores/preview.ts';
import { DEFAULT_ROUND, jackpotHud } from './jackpot-hud.ts';

const R = { ...DEFAULT_ROUND, upper: PREVIEW_UPPER_SPEC };
const req = (p: Pick<PreviewRequest, 'upper' | 'gase'>): PreviewRequest => ({ pattern: '', hit: true, serial: p.gase ? gaseSerial(2000000000, 1) : 2000000001, color: 'white', ...p });
const hud = (p: Pick<PreviewRequest, 'upper' | 'gase'>, ms: number) => {
  const v = jackpotHud(upperPreviewState(req(p), 0), ms, R, 1);
  if (v?.k !== 'round') throw new Error('round の表示が必要');
  return v;
};

test('Debug のプレビューは 上位（上乗せ 0 / 1 / 4 回）とガセの4つ。全ラウンドは 20 / 30 / 60 と 10', () => {
  expect(UPPER_PREVIEWS.map((p) => upperPreviewRounds(p))).toEqual([20, 30, 60, 10]);
});

test('上位: 5秒で液晶が白黒・HUD が止まり、割れる前に 10R のまま、割れて 20R と +出玉', () => {
  const p = { upper: { loops: 0 } };
  expect(hud(p, 3000).upper).toMatchObject({ gray: 0, frozen: false });
  const frozen = hud(p, 5400);
  expect(frozen.upper).toMatchObject({ gray: 1, frozen: true });
  expect(frozen.rounds).toBe(10);
  // 止まっている間は HUD の数字が動かない（ラウンドは裏で進む）。
  expect(hud(p, 9000).balls).toBe(frozen.balls);
  expect(hud(p, 9000).upper?.crack).toBe(7);
  const broke = hud(p, 9700);
  expect(broke.upper?.banner).toMatchObject({ k: 'upperIn', rainbow: true });
  expect(broke.rounds).toBe(20);
  expect(broke.upper?.addBalls).toBeGreaterThan(0);
});

test('上乗せ 4 回は最後に「上乗せ MAX」で全ラウンド 60R、色が戻る', () => {
  const p = { upper: { loops: 4 } };
  let max = 0;
  let sawMax = false;
  for (let ms = 5000; ms < 60 * 5000 - 4500; ms += 100) {
    const v = hud(p, ms);
    max = Math.max(max, v.rounds);
    if (v.upper?.banner?.k === 'uwanoseMax') sawMax = true;
    expect(v.round === 60 || v.rounds > v.round).toBe(true);
  }
  expect(sawMax).toBe(true);
  expect(max).toBe(60);
  expect(hud(p, 60 * 5000 - 4600).upper?.gray).toBe(0);
});

test('ガセ: 白黒・フリーズのあと割れずに色が戻る（ひびも告知も無し）', () => {
  const p = { gase: true };
  expect(hud(p, 5400).upper).toMatchObject({ gray: 1, frozen: true });
  for (let ms = 5000; ms < 10 * 5000 - 4500; ms += 100) {
    const u = hud(p, ms).upper;
    expect(u?.crack).toBe(0);
    expect(u?.banner).toBeNull();
  }
  expect(hud(p, 8000).upper).toMatchObject({ gray: 0, frozen: false });
  expect(hud(p, 8000).rounds).toBe(10);
});

test('時刻表の演出は全てパックにある（wash_rainbow も読める）', () => {
  const names = new Set(pack.sheets.map((s) => s.pattern));
  for (const cue of Object.values(UPPER_CUES)) expect(names.has(cue)).toBe(true);
  const flashes = pack.sheets.flatMap((s) => s.cues).filter((c) => c.kind === 'flash');
  expect(flashes.some((c) => c.kind === 'flash' && c.style === 'wash_rainbow')).toBe(true);
});
