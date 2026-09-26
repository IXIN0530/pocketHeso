import type { Cue, CueSheet, LcdCue } from '@ph/shared';
import { resolveCueSheet } from './resolve.ts';

export interface SpinPlanOptions {
  readonly seed: number;
  /** 変動の通し番号（保留の entry）。 */
  readonly serial: number;
  /** 設定の強度 1〜3。 */
  readonly intensity: number;
  /** パターンの基準の尺（patterns.json の ms。シートの時刻はこれを基準に書く）。 */
  readonly patternMs: number;
  /** 実際の変動時間（変動短縮・保留3〜4の短縮込み）。 */
  readonly durationMs: number;
}

export interface SpinPlan {
  /** 分岐ごとに選んだ option の index（ログ比較用）。 */
  readonly picks: readonly number[];
  /** 液晶以外のキュー（音・光・振動・揺れ・カメラ。at 昇順）。 */
  readonly cues: readonly Cue[];
  /** 液晶のシーン（at 昇順）。 */
  readonly lcd: readonly LcdCue[];
}

export const EMPTY_SPIN_PLAN: SpinPlan = { picks: [], cues: [], lcd: [] };

/**
 * 変動1回の演出を決める（spec/43, D-067）。分岐は resolveCueSheet（RNGStream(seed, 'presentation', serial)）で、
 * 時刻は実際の変動時間に合わせて伸縮する（尺をパターンの ms に一致させる）。液晶のシーンは終了時刻で切る。
 */
export function planSpin(sheet: CueSheet | undefined, o: SpinPlanOptions): SpinPlan {
  if (!sheet) return EMPTY_SPIN_PLAN;
  const r = resolveCueSheet(sheet, o);
  const k = o.patternMs > 0 && o.durationMs > 0 ? o.durationMs / o.patternMs : 1;
  const cues: Cue[] = [];
  const lcd: LcdCue[] = [];
  for (const c of r.cues) {
    const at = Math.round(c.at * k);
    if (c.kind === 'lcd') {
      const ms = Math.min(Math.round(c.ms * k), o.durationMs - at);
      if (ms > 0) lcd.push({ ...c, at, ms });
    } else if (at < o.durationMs) {
      cues.push({ ...c, at });
    }
  }
  return { picks: r.picks, cues, lcd };
}

export interface ActiveScene {
  readonly cue: LcdCue;
  /** シーン開始からの経過 ms。 */
  readonly t: number;
  /** 進み具合 0〜1。 */
  readonly p: number;
}

/** 変動開始から t ms の時点で効いている液晶シーン（at 昇順。後のものほど上に描く）。 */
export function activeScenes(lcd: readonly LcdCue[], t: number): ActiveScene[] {
  const out: ActiveScene[] = [];
  for (const cue of lcd) {
    if (cue.at > t) break;
    const dt = t - cue.at;
    if (dt < cue.ms) out.push({ cue, t: dt, p: dt / cue.ms });
  }
  return out;
}
