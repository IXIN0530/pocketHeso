import { useEffect, useRef, useState } from 'react';
import { parseBoard, parseLaunchDirs } from '@ph/core';
import boardJson from '../../../../resources/boards/default.json';
import dirsJson from '../../../../resources/boards/launch_dirs.json';
import { clock } from '../stores/clock.ts';
import { onShots, useEngine } from '../stores/engine.ts';
import { BoardScene, type DrawInfo } from './board-scene.ts';
import type { FrameStats } from './frame-stats.ts';
import styles from './board.module.css';

const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));
const showStats = new URLSearchParams(location.search).get('debug') === '1';

/**
 * 盤面（spec/50）。Three のシーンは命令的に保持し、Engine の玉と役物は ref 経由で渡す（毎フレームの React 再レンダーなし）。
 * `?debug=1` の時だけ fps・draw call・時間倍率を重ねる。
 */
export function BoardCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<(FrameStats & DrawInfo) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let scene: BoardScene;
    try {
      scene = new BoardScene(host, parseBoard(boardJson), parseLaunchDirs(dirsJson), clock);
    } catch (e) {
      setError(errText(e));
      return;
    }
    const offShots = onShots((shots) => scene.addShots(shots));
    const showYaku = (p: ReturnType<typeof useEngine.getState>['projection']) => {
      if (p) scene.setYakumono(p.yakumono, p.at);
    };
    showYaku(useEngine.getState().projection);
    const offYaku = useEngine.subscribe((s, prev) => {
      if (s.projection !== prev.projection) showYaku(s.projection);
    });
    // 背面・非表示の間は描画ループを止める（spec/50）。
    const onVis = () => scene.setRunning(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVis);
    const timer = showStats
      ? window.setInterval(() => {
          const s = scene.takeStats();
          if (s.frames > 0) setStats({ ...s, ...scene.info });
        }, 1000)
      : undefined;
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
      offShots();
      offYaku();
      scene.destroy();
    };
  }, []);

  return (
    <div className={styles.frame}>
      <div ref={hostRef} className={styles.canvas} />
      {stats && (
        <p className={styles.stats}>
          {stats.fps.toFixed(0)} fps · p95 {stats.p95Ms.toFixed(0)}ms · {stats.calls} calls · x{clock.scale}
        </p>
      )}
      {error && <p className={styles.error}>盤面を描けません: {error}</p>}
    </div>
  );
}

export default BoardCanvas;
