import { useEffect, useRef, useState } from 'react';
import { isStandalone } from '../platform/pwa.ts';
import { buildQuery, DEFAULT_ENDPOINT, evaluate, type Facility, parseOverpass, QUERY_LIMIT } from './geo-overpass.ts';
import styles from './spike.module.css';

const stamp = () => new Date().toISOString().slice(11, 23);
const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));
const GEO_ERR: Record<number, string> = { 1: 'PERMISSION_DENIED', 2: 'POSITION_UNAVAILABLE', 3: 'TIMEOUT' };

interface Fix {
  lat: number;
  lon: number;
  accuracy: number;
  tookMs: number;
}

/** P0-T4: 位置情報の許可状態・accuracy と、spec/32 の Overpass クエリ結果の実測画面。座標は画面にも保存にも出さない。 */
export function GeoSpike() {
  const [log, setLog] = useState<string[]>([]);
  const [perm, setPerm] = useState('?');
  const [fix, setFix] = useState<Fix | null>(null);
  const [radius, setRadius] = useState(300);
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT);
  const [facilities, setFacilities] = useState<Facility[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [showNames, setShowNames] = useState(false);
  const accuracies = useRef<number[]>([]);

  const add = (line: string) => setLog((l) => [`${stamp()} ${line}`, ...l].slice(0, 50));

  useEffect(() => {
    add(`起動 standalone=${isStandalone()} permissions=${typeof navigator.permissions?.query}`);
    let status: PermissionStatus | null = null;
    const onChange = () => {
      if (!status) return;
      setPerm(status.state);
      add(`許可状態の変化 → ${status.state}`);
    };
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((s) => {
        status = s;
        setPerm(s.state);
        add(`許可状態（起動時）= ${s.state}`);
        s.addEventListener('change', onChange);
      })
      .catch((e: unknown) => add(`permissions.query 失敗: ${errText(e)}`));
    return () => status?.removeEventListener('change', onChange);
  }, []);

  const locate = () => {
    const t0 = performance.now();
    add('getCurrentPosition 開始');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const tookMs = Math.round(performance.now() - t0);
        const accuracy = Math.round(p.coords.accuracy);
        accuracies.current = [...accuracies.current, accuracy];
        setFix({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy, tookMs });
        add(`取得 accuracy=${accuracy}m (${tookMs}ms)${accuracy > 150 ? ' ※150m 超: 再取得を促す条件' : ''}`);
      },
      (e) => add(`取得失敗 ${GEO_ERR[e.code] ?? e.code}: ${e.message} (${Math.round(performance.now() - t0)}ms)`),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const query = async () => {
    if (!fix) return;
    setBusy(true);
    const t0 = performance.now();
    add(`Overpass 問い合わせ 半径 ${radius}m`);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(buildQuery(fix.lat, fix.lon, radius))}`,
      });
      const ms = Math.round(performance.now() - t0);
      if (!res.ok) {
        add(`Overpass HTTP ${res.status} (${ms}ms)`);
        return;
      }
      const list = parseOverpass(await res.json());
      setFacilities(list);
      add(`Overpass OK ${list.length} 件 (${ms}ms)`);
      if (list.length >= QUERY_LIMIT) add(`※上限 ${QUERY_LIMIT} 件に到達: ID 順で切られるので近くの施設が漏れている可能性あり`);
    } catch (e) {
      add(`Overpass 失敗: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const evaluated = fix && facilities ? evaluate(fix.lat, fix.lon, fix.accuracy, facilities) : [];
  const accs = accuracies.current;
  const summary = accs.length ? `n=${accs.length} 最小 ${Math.min(...accs)}m / 最大 ${Math.max(...accs)}m / 直近 ${accs.join(', ')}` : '未取得';
  const inRange = evaluated.filter((f) => f.inRange).length;
  const inRangePlusAcc = evaluated.filter((f) => f.inRangePlusAcc).length;

  return (
    <main className={styles.main}>
      <a className={styles.back} href="/">← 本体へ</a>
      <h1>spike: geo</h1>
      <p>
        standalone={String(isStandalone())} / 許可状態={perm}
      </p>
      <div className={styles.row}>
        <button className={styles.button} onClick={locate}>現在地を取得</button>
        <button className={styles.button} disabled={!fix || busy} onClick={() => void query()}>
          Overpass 検索
        </button>
        <button className={styles.button} onClick={() => setLog([])}>ログ消去</button>
      </div>
      <p>accuracy: {summary}</p>
      <label>
        検索半径（m, 既定 300）
        <input
          className={styles.input}
          type="number"
          inputMode="numeric"
          value={radius}
          onChange={(e) => setRadius(Math.max(50, Math.min(1000, Number(e.target.value) || 300)))}
        />
      </label>
      <label>
        エンドポイント
        <input className={styles.input} value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
      </label>
      {facilities && (
        <>
          <h2>
            施設 {evaluated.length} 件（範囲内 {inRange} / 半径+accuracy なら {inRangePlusAcc}）
          </h2>
          <p>
            左の ●/○ = spec の判定、右の ●/○ = 種類別半径に accuracy を足した場合。記録に残すのは件数・accuracy・判定の内訳だけで、
            名前と ID は書かない（リポジトリは公開）。
          </p>
          <label>
            <input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} /> 名前と ID を表示（確認用）
          </label>
          <pre className={styles.pre}>
            {evaluated
              .map(
                (f) =>
                  `${f.inRange ? '●' : '○'}${f.inRangePlusAcc ? '●' : '○'} ${f.centerM.toFixed(0).padStart(4)}m ${f.leisure}` +
                  ` [${f.rule}${f.bboxDiagM === null ? '' : ` 対角${f.bboxDiagM.toFixed(0)}m`}]` +
                  (showNames ? ` ${f.name || '(名前なし)'} ${f.id}` : ''),
              )
              .join('\n') || '0 件'}
          </pre>
        </>
      )}
      <h2>ログ（新しい順）</h2>
      <pre className={styles.pre}>{log.join('\n')}</pre>
    </main>
  );
}
