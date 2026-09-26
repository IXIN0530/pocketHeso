// 液晶の演出シーン（CueSheet の lcd キュー, D-067）→ シェーダーに渡す値。Three に依存しない（テスト用）。
import { activeScenes } from '@ph/fx';
import type { LcdCue } from '@ph/shared';

/** テロップの出し方（0 中央に飛び出す / 1 斜めの帯で横切る）。 */
export type TextMode = 0 | 1;

export interface LcdText {
  /** テクスチャアトラスの行。 */
  readonly row: number;
  readonly mode: TextMode;
  /** 表示開始からの ms と進み具合 0〜1。 */
  readonly t: number;
  readonly p: number;
  readonly color: readonly [number, number, number];
}

export interface LcdLook {
  /** SP リーチの背景（0〜1）。 */
  readonly sp: number;
  /** 決め（最後の数秒の脈動, 0〜1）。 */
  readonly climax: number;
  /** ブラックアウト（0〜1）。 */
  readonly black: number;
  /** 確定の虹背景（0〜1）。 */
  readonly kakutei: number;
  /** キリン柄（0〜1）。 */
  readonly kirin: number;
  /** 群予告の進み具合（無い時は -1）。 */
  readonly group: number;
  /** 疑似連の瞬間の光（0〜1）。 */
  readonly pseudo: number;
  readonly text: LcdText | null;
}

export const NO_LOOK: LcdLook = { sp: 0, climax: 0, black: 0, kakutei: 0, kirin: 0, group: -1, pseudo: 0, text: null };

const FADE_MS = 250;

/** 入り・抜けを FADE_MS でなめらかにした強さ。 */
function fade(t: number, ms: number, fadeMs = FADE_MS): number {
  return Math.max(0, Math.min(1, t / fadeMs, (ms - t) / fadeMs));
}

function rgb(hex: string | undefined): [number, number, number] {
  if (hex === undefined) return [1, 1, 1];
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * 変動開始から t ms の液晶の見た目。同じ種類のシーンが重なったら強い方、テロップは後に始まった方を出す。
 * textRow はテロップの文字 → アトラスの行（焼いていない文字は -1 で出さない）。
 */
export function lcdLook(lcd: readonly LcdCue[], t: number, textRow: (text: string) => number): LcdLook {
  if (lcd.length === 0) return NO_LOOK;
  let sp = 0;
  let climax = 0;
  let black = 0;
  let kakutei = 0;
  let kirin = 0;
  let group = -1;
  let pseudo = 0;
  let text: LcdText | null = null;
  for (const s of activeScenes(lcd, t)) {
    const c = s.cue;
    const f = fade(s.t, c.ms);
    switch (c.scene) {
      case 'sp':
        sp = Math.max(sp, fade(s.t, c.ms, 600));
        break;
      case 'climax':
        climax = Math.max(climax, f);
        break;
      case 'blackout':
        black = Math.max(black, fade(s.t, c.ms, 120));
        break;
      case 'kakutei':
        kakutei = Math.max(kakutei, fade(s.t, c.ms, 400));
        break;
      case 'kirin':
        kirin = Math.max(kirin, f);
        break;
      case 'group':
        group = s.p;
        break;
      case 'pseudo':
        pseudo = Math.max(pseudo, Math.max(0, 1 - s.t / 300));
        break;
    }
    const mode: TextMode | null = c.scene === 'telop' || c.scene === 'pseudo' ? 0 : c.scene === 'cutin' ? 1 : null;
    if (mode !== null && c.text !== undefined) {
      const row = textRow(c.text);
      if (row >= 0) text = { row, mode, t: s.t, p: s.p, color: rgb(c.color) };
    }
  }
  return { sp, climax, black, kakutei, kirin, group, pseudo, text };
}

/** 疑似連の区間（変動開始からの ms。液晶の図柄をいったん止めて回し直す）。 */
export function pseudoWindows(lcd: readonly LcdCue[]): { readonly from: number; readonly to: number }[] {
  return lcd.filter((c) => c.scene === 'pseudo').map((c) => ({ from: c.at, to: c.at + c.ms }));
}

/** リーチで左右の図柄が揃う時刻（変動開始からの ms。シートに無ければ null）。 */
export function reachAt(lcd: readonly LcdCue[]): number | null {
  return lcd.find((c) => c.scene === 'reach')?.at ?? null;
}
