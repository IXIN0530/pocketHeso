import { useEffect, useRef, useState } from 'react';
import { parseBoard, parseLaunchDirs } from '@ph/core';
import boardJson from '../../../../resources/boards/default.json';
import dirsJson from '../../../../resources/boards/launch_dirs.json';
import { BakeoffBoard, type DrawInfo } from './bakeoff-board.ts';
import type { FrameStats } from './frame-stats.ts';
import styles from './bakeoff.module.css';

const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

/** BAKEOFF: 描画比較用スパイク（`?spike=bakeoff`）。画面タップで当たり演出。 */
export function BakeoffSpike() {
  const hostRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<BakeoffBoard | null>(null);
  const [stats, setStats] = useState<FrameStats | null>(null);
  const [info, setInfo] = useState<DrawInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [winKey, setWinKey] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    const pops = popRef.current;
    if (!host || !pops) return;
    let board: BakeoffBoard;
    try {
      board = new BakeoffBoard(host, pops, parseBoard(boardJson), parseLaunchDirs(dirsJson));
    } catch (e) {
      setError(errText(e));
      return;
    }
    boardRef.current = board;
    const timer = window.setInterval(() => {
      const s = board.takeStats();
      if (s.frames === 0) return;
      setStats(s);
      setInfo(board.info);
    }, 500);
    // 背面・非表示の間は描画ループを止める（spec/50）。
    const onVis = () => board.setRunning(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
      board.destroy();
      boardRef.current = null;
    };
  }, []);

  const win = () => {
    boardRef.current?.win();
    setWinKey((k) => k + 1);
  };

  return (
    <main className={styles.root} onPointerDown={win}>
      <div ref={hostRef} className={styles.canvas} />
      <div ref={popRef} className={styles.pops} />
      {winKey > 0 && (
        <div key={winKey} className={styles.banner}>
          大当り
        </div>
      )}
      <p className={styles.stats}>
        {stats ? `${stats.fps.toFixed(0)} fps` : '…'} · {info ? `${info.calls} calls` : '…'}
      </p>
      <a className={styles.back} href="/" onPointerDown={(e) => e.stopPropagation()}>
        戻る
      </a>
      {error ? <p className={styles.error}>Three 初期化失敗: {error}</p> : <p className={styles.hint}>タップで当たり</p>}
    </main>
  );
}
