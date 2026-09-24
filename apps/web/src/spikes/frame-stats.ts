export interface FrameStats {
  fps: number;
  p95Ms: number;
  maxMs: number;
  frames: number;
}

/** フレーム間隔（ms）の列から fps・p95・最大を出す（P0 スパイク共通）。 */
export function summarize(frameMs: readonly number[]): FrameStats {
  if (frameMs.length === 0) return { fps: 0, p95Ms: 0, maxMs: 0, frames: 0 };
  const total = frameMs.reduce((a, b) => a + b, 0);
  const sorted = [...frameMs].sort((a, b) => a - b);
  return {
    fps: (frameMs.length * 1000) / total,
    p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
    frames: frameMs.length,
  };
}
