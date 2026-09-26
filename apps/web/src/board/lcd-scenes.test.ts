import { expect, test } from 'vitest';
import type { LcdCue } from '@ph/shared';
import { NO_LOOK, lcdLook, pseudoWindows, reachAt } from './lcd-scenes.ts';

const cue = (at: number, scene: string, ms: number, extra: Partial<LcdCue> = {}): LcdCue => ({ at, kind: 'lcd', scene, ms, ...extra });
const rows = ['リーチ', 'SPリーチ', '×2'];
const row = (t: string) => rows.indexOf(t);

const sheet: LcdCue[] = [
  cue(0, 'group', 2000),
  cue(2000, 'pseudo', 900, { text: '×2', color: '#ffd23f' }),
  cue(4000, 'reach', 16000),
  cue(4000, 'telop', 1400, { text: 'リーチ' }),
  cue(6000, 'sp', 10000),
  cue(6000, 'cutin', 1800, { text: 'SPリーチ', color: '#ff0000' }),
  cue(9000, 'telop', 1000, { text: '未知の文字' }),
  cue(18000, 'climax', 2000),
];

test('scenes map to shader values with fades', () => {
  expect(lcdLook([], 100, row)).toBe(NO_LOOK);
  expect(lcdLook(sheet, 1000, row).group).toBeCloseTo(0.5);
  const pseudo = lcdLook(sheet, 2000, row);
  expect(pseudo.pseudo).toBe(1);
  expect(pseudo.text).toMatchObject({ row: 2, mode: 0, color: [1, 0xd2 / 255, 0x3f / 255] });
  expect(lcdLook(sheet, 4100, row).text).toMatchObject({ row: 0, mode: 0, color: [1, 1, 1] });
  // SP は 600ms かけて入り、後から始まったテロップ（帯）が上に出る。
  const sp = lcdLook(sheet, 6300, row);
  expect(sp.sp).toBeCloseTo(0.5);
  expect(sp.text).toMatchObject({ row: 1, mode: 1 });
  expect(lcdLook(sheet, 12000, row).sp).toBe(1);
  // 焼いていない文字は出さない。
  expect(lcdLook(sheet, 9500, row).text).toBeNull();
  expect(lcdLook(sheet, 19000, row).climax).toBe(1);
  expect(lcdLook(sheet, 20000, row)).toEqual(NO_LOOK);
});

test('reach time and pseudo windows come from the sheet', () => {
  expect(reachAt(sheet)).toBe(4000);
  expect(reachAt([cue(0, 'sp', 100)])).toBeNull();
  expect(pseudoWindows(sheet)).toEqual([{ from: 2000, to: 2900 }]);
});
