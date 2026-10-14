import { useEffect, useRef, useState } from 'react';
import { parseBoard, parseLaunchDirs } from '@ph/core';
import boardJson from '../../../../resources/boards/default.json';
import dirsJson from '../../../../resources/boards/launch_dirs.json';
import patternsJson from '../../../../resources/machines/patterns.json';
import { machineRound } from '../engine/game-config.ts';
import { installAudioUnlock } from '../fx/fx-host.ts';
import { clock } from '../stores/clock.ts';
import { onShots, onView, useEngine } from '../stores/engine.ts';
import { usePrefs } from '../stores/prefs.ts';
import { usePreview } from '../stores/preview.ts';
import { BoardScene, type DrawInfo, type PatternInfo } from './board-scene.ts';
import type { FrameStats } from './frame-stats.ts';
import { resolveLook } from './look.ts';
import styles from './board.module.css';

const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));
// 正式版は `?debug=1` でも重ねない（D-087）。
const showStats = __DEV_TOOLS__ && new URLSearchParams(location.search).get('debug') === '1';
const byPattern = new Map<string, PatternInfo>(
  (patternsJson as readonly { id: string; hot: number; ms: number }[]).map((p) => [p.id, { hot: p.hot, ms: p.ms }]),
);
const patternInfo = (id: string) => byPattern.get(id);

/**
 * 盤面（spec/50）。Three のシーンは命令的に保持し、Engine の玉・役物・液晶のイベントは購読で渡す（毎フレームの React 再レンダーなし）。
 * `?debug=1` の時だけ fps・draw call・時間倍率を重ねる。active=false（別タブ表示中）の間は描画を止める。
 */
export function BoardCanvas({ active = true }: { active?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<BoardScene | null>(null);
  const activeRef = useRef(active);
  const [stats, setStats] = useState<(FrameStats & DrawInfo) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let scene: BoardScene;
    try {
      scene = new BoardScene(host, parseBoard(boardJson), parseLaunchDirs(dirsJson), clock, patternInfo);
    } catch (e) {
      setError(errText(e));
      return;
    }
    sceneRef.current = scene;
    const offAudio = installAudioUnlock();
    scene.setBloom(usePrefs.getState().bloom);
    const offPrefs = usePrefs.subscribe((p) => scene.setBloom(p.bloom));
    const applyLook = () => scene.setLook(resolveLook(useEngine.getState().projection?.tree?.unlocks ?? [], usePrefs.getState().looksOff));
    applyLook();
    const offLookPrefs = usePrefs.subscribe((p, prev) => {
      if (p.looksOff !== prev.looksOff) applyLook();
    });
    const offShots = onShots((shots) => scene.addShots(shots));
    const offView = onView((p, events) => scene.pushView(p, events));
    const showYaku = (p: ReturnType<typeof useEngine.getState>['projection']) => {
      if (p) scene.setYakumono(p.yakumono, p.at);
    };
    showYaku(useEngine.getState().projection);
    scene.setSeed(useEngine.getState().seed);
    const setRound = (id: string) => {
      const r = machineRound(id);
      if (r) scene.setRound(r);
    };
    setRound(useEngine.getState().machineId);
    const offYaku = useEngine.subscribe((s, prev) => {
      if (s.projection !== prev.projection) {
        showYaku(s.projection);
        applyLook();
      }
      if (s.seed !== prev.seed) scene.setSeed(s.seed);
      if (s.machineId !== prev.machineId) setRound(s.machineId);
    });
    const offPreview = usePreview.subscribe((s, prev) => {
      if (s.request && s.request !== prev.request) scene.playPreview(s.request);
    });
    // 背面・非表示の間は描画ループを止める（spec/50）。
    const onVis = () => scene.setRunning(activeRef.current && document.visibilityState === 'visible');
    onVis();
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
      offView();
      offYaku();
      offPreview();
      offPrefs();
      offLookPrefs();
      offAudio();
      sceneRef.current = null;
      scene.destroy();
    };
  }, []);

  useEffect(() => {
    activeRef.current = active;
    sceneRef.current?.setRunning(active && document.visibilityState === 'visible');
  }, [active]);

  return (
    <div className={styles.frame}>
      <div ref={hostRef} className={styles.canvas} />
      {__DEV_TOOLS__ && stats && (
        <p className={styles.stats}>
          {stats.fps.toFixed(0)} fps · p95 {stats.p95Ms.toFixed(0)}ms · {stats.calls} calls · x{clock.scale}
        </p>
      )}
      {error && <p className={styles.error}>盤面を描けません: {error}</p>}
    </div>
  );
}

export default BoardCanvas;
