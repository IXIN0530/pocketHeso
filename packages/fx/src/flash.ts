// 光過敏の安全策（spec/43, 設定で外せない）。Three に依存しない判定だけを置く（テスト対象）。

/** フラッシュは 1秒あたりこの回数まで。 */
export const FLASH_MAX_PER_SEC = 3;
/** 全画面フラッシュの最大の明るさ（加算の不透明度）。急な明滅の輝度差を制限する。 */
export const FLASH_MAX_ALPHA = 0.5;
/** 立ち上がりの最短時間（瞬間的な全白を避ける）。 */
export const FLASH_RAMP_MS = 60;
/** reduced-motion 時のフェードの最大の明るさ。 */
export const FADE_MAX_ALPHA = 0.2;

/** 直近1秒に始まったフラッシュを数え、FLASH_MAX_PER_SEC を超えるものを断る。 */
export class FlashLimiter {
  private starts: number[] = [];

  /** nowMs に1回光らせてよいか。true なら回数に数える。 */
  allow(nowMs: number): boolean {
    this.starts = this.starts.filter((t) => t > nowMs - 1000 && t <= nowMs);
    if (this.starts.length >= FLASH_MAX_PER_SEC) return false;
    this.starts.push(nowMs);
    return true;
  }

  reset(): void {
    this.starts = [];
  }
}

/**
 * フラッシュの明るさ（0〜FLASH_MAX_ALPHA）。elapsedMs は開始からの経過。
 * 通常は FLASH_RAMP_MS で立ち上げて ms までに消す。reduced-motion は ms 全体をかけた弱いフェードに置き換える。
 */
export function flashAlpha(elapsedMs: number, ms: number, reducedMotion: boolean): number {
  if (elapsedMs < 0 || elapsedMs >= ms) return 0;
  if (reducedMotion) {
    const half = ms / 2;
    const k = elapsedMs < half ? elapsedMs / half : (ms - elapsedMs) / half;
    return FADE_MAX_ALPHA * k;
  }
  const ramp = Math.min(FLASH_RAMP_MS, ms / 2);
  const k = elapsedMs < ramp ? elapsedMs / ramp : (ms - elapsedMs) / (ms - ramp);
  return FLASH_MAX_ALPHA * k;
}
