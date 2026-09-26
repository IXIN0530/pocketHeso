import { useEffect, useRef, useState } from 'react';
import { parseBoard, parseLaunchDirs } from '@ph/core';
import boardJson from '../../../../resources/boards/default.json';
import dirsJson from '../../../../resources/boards/launch_dirs.json';
import { BoardScene, type DrawInfo } from '../board/board-scene.ts';
import type { FrameStats } from '../board/frame-stats.ts';
import { makeClock } from '../stores/clock.ts';
import { DemoShots } from './bakeoff-balls.ts';
import styles from './bakeoff.module.css';

const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

/** 盤面のデモ（`?spike=bakeoff`, P5-T0 の比較から継続）。本番の BoardScene にデモの玉を流す。画面タップで当たり演出。 */
const DEMO_FIRE_MS = 150;
const DEMO_YAKUMONO = [2, 1.6, 2.8, 2.4, 1.2, 1.2, 3.6, 2.2].map((periodS) => ({ lv: 1, phase: 0, periodS }));

export function BakeoffSpike() {
  const hostRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<BoardScene | null>(null);
  const [stats, setStats] = useState<FrameStats | null>(null);
  const [info, setInfo] = useState<DrawInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [winKey, setWinKey] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let board: BoardScene;
    const clock = makeClock(1);
    const b = parseBoard(boardJson);
    const dirs = parseLaunchDirs(dirsJson);
    try {
      board = new BoardScene(host, b, dirs, clock);
    } catch (e) {
      setError(errText(e));
      return;
    }
    boardRef.current = board;
    board.setYakumono(DEMO_YAKUMONO, clock.now());
    const demo = new DemoShots(b, dirs);
    const fire = window.setInterval(() => {
      const s = demo.next(clock.now());
      if (s) board.addShots([s]);
    }, DEMO_FIRE_MS);
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
      window.clearInterval(fire);
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
