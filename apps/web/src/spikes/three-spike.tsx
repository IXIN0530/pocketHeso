import { useEffect, useRef, useState } from 'react';
import { isStandalone } from '../platform/pwa.ts';
import type { FrameStats } from './frame-stats.ts';
import { ThreeBoard, type DrawInfo, type ThreeOptions } from './three-board.ts';
import styles from './spike.module.css';

const stamp = () => new Date().toISOString().slice(11, 23);
const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));
const DPR = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1)));

/** P0-T6: Three.js で立体に描いた台の見た目・性能・発熱（1分ごとの fps 推移）の実測画面。 */
export function ThreeSpike() {
  const hostRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<ThreeBoard | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [opts, setOpts] = useState<ThreeOptions>({ balls: 20, bloom: true, rainbow: false, glass: true });
  const [pixelRatio, setPixelRatio] = useState(DPR);
  const [stats, setStats] = useState<FrameStats | null>(null);
  const [info, setInfo] = useState<DrawInfo | null>(null);
  const [worst, setWorst] = useState<number | null>(null);
  const [minutes, setMinutes] = useState(0);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const add = (line: string) => setLog((l) => [`${stamp()} ${line}`, ...l].slice(0, 80));

  useEffect(() => {
    add(`起動 standalone=${isStandalone()} dpr=${window.devicePixelRatio} ua=${navigator.userAgent}`);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let board: ThreeBoard;
    try {
      board = new ThreeBoard(host, optsRef.current, pixelRatio);
    } catch (e) {
      add(`Three 初期化失敗: ${errText(e)}`);
      return;
    }
    boardRef.current = board;
    add(`Three 初期化 pixelRatio=${pixelRatio}`);
    setWorst(null);
    setMinutes(0);
    let windows = 0;
    let minuteFps: number[] = [];
    const timer = window.setInterval(() => {
      const s = board.takeStats();
      if (s.frames === 0) return;
      setStats(s);
      setInfo(board.info);
      // 起動直後（シェーダーのコンパイル等）の2窓は集計に含めない。
      if (++windows <= 2) return;
      setWorst((w) => (w === null ? s.fps : Math.min(w, s.fps)));
      minuteFps.push(s.fps);
      if (minuteFps.length === 60) {
        const avg = minuteFps.reduce((a, b) => a + b, 0) / minuteFps.length;
        const o = optsRef.current;
        setMinutes((m) => {
          add(
            `${m + 1}分 平均fps=${avg.toFixed(1)} 最低fps=${Math.min(...minuteFps).toFixed(1)} ` +
              `ブルーム=${o.bloom} 虹=${o.rainbow} ガラス=${o.glass} 玉${o.balls} pr=${pixelRatio}`,
          );
          return m + 1;
        });
        minuteFps = [];
      }
    }, 1000);
    const onVis = () => {
      const visible = document.visibilityState === 'visible';
      board.setRunning(visible);
      // 背面に行ったら1分窓を捨てる（止まっていた時間を混ぜない）。
      if (!visible) minuteFps = [];
      add(visible ? '前面に戻った' : '背面へ（描画停止）');
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
      board.destroy();
      boardRef.current = null;
    };
  }, [pixelRatio]);

  useEffect(() => boardRef.current?.apply(opts), [opts]);

  const toggle = (key: 'bloom' | 'rainbow' | 'glass') => setOpts((o) => ({ ...o, [key]: !o[key] }));
  const report = () =>
    add(
      `計測 fps=${stats?.fps.toFixed(1) ?? '-'} p95=${stats?.p95Ms.toFixed(1) ?? '-'}ms max=${stats?.maxMs.toFixed(1) ?? '-'}ms ` +
        `最低fps=${worst?.toFixed(1) ?? '-'} calls=${info?.calls ?? '-'} tris=${info?.triangles ?? '-'} ` +
        `ブルーム=${opts.bloom} 虹=${opts.rainbow} ガラス=${opts.glass} 玉${opts.balls} pr=${pixelRatio}`,
    );

  return (
    <main className={styles.main}>
      <p>
        <a className={styles.back} href="/">
          ← 戻る
        </a>
      </p>
      <h1>P0-T6 Three.js</h1>
      <div ref={hostRef} style={{ width: '100%', height: '62dvh', borderRadius: 12, overflow: 'hidden' }} />
      <p style={{ fontVariantNumeric: 'tabular-nums', fontSize: 18 }}>
        {stats ? `${stats.fps.toFixed(1)} fps / p95 ${stats.p95Ms.toFixed(1)}ms / max ${stats.maxMs.toFixed(1)}ms` : '計測中…'}
        <br />
        最低 {worst?.toFixed(1) ?? '-'} fps / 経過 {minutes} 分 / calls {info?.calls ?? '-'} / tris {info?.triangles ?? '-'}
      </p>
      <div className={styles.row}>
        <button className={styles.button} onClick={() => boardRef.current?.reach()}>
          リーチ（カメラ寄り）
        </button>
        <button className={styles.button} onClick={() => toggle('bloom')}>
          ブルーム {opts.bloom ? 'ON' : 'OFF'}
        </button>
        <button className={styles.button} onClick={() => toggle('rainbow')}>
          虹 {opts.rainbow ? 'ON' : 'OFF'}
        </button>
        <button className={styles.button} onClick={() => toggle('glass')}>
          ガラス {opts.glass ? 'ON' : 'OFF'}
        </button>
        <button className={styles.button} onClick={() => setOpts((o) => ({ ...o, balls: o.balls === 20 ? 100 : 20 }))}>
          玉 {opts.balls}
        </button>
        {[1, 2, 3].map((r) => (
          <button key={r} className={styles.button} disabled={r === pixelRatio} onClick={() => setPixelRatio(r)}>
            pr {r}
          </button>
        ))}
        <button className={styles.button} onClick={() => setWorst(null)}>
          最低値リセット
        </button>
        <button className={styles.button} onClick={report}>
          ログに記録
        </button>
      </div>
      <p>
        既定 = 玉20・真鍮の釘・役物8・液晶・枠ランプ・ガラス・ブルーム。発熱は既定のまま10分置く（画面は消さない）。1分ごとの平均 fps がログに出る。
        虹は全画面フラッシュの負荷確認用。
      </p>
      <h2>ログ（新しい順）</h2>
      <pre className={styles.pre}>{log.join('\n')}</pre>
    </main>
  );
}
