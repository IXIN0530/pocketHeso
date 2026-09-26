import { useEffect, useRef, useState } from 'react';
import { isStandalone } from '../platform/pwa.ts';
import { distanceM, parseYolp, type YolpPlace } from '@ph/claims';
import { fetchJsonp, YOLP_CREDIT, yolpUrl } from '../platform/yolp.ts';
import styles from './spike.module.css';

const stamp = () => new Date().toISOString().slice(11, 23);
const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));
const GEO_ERR: Record<number, string> = { 1: 'PERMISSION_DENIED', 2: 'POSITION_UNAVAILABLE', 3: 'TIMEOUT' };

const APPID_KEY = 'ph.spike.yolpAppid';

const loadAppid = () => {
  try {
    return localStorage.getItem(APPID_KEY) ?? '';
  } catch {
    return '';
  }
};

interface Fix {
  lat: number;
  lon: number;
  accuracy: number;
  tookMs: number;
}

/** P0-T4: 位置情報の許可状態・accuracy と、近くの施設検索（YOLP）の実測画面。座標は画面にも保存にも出さない。 */
export function GeoSpike() {
  const [log, setLog] = useState<string[]>([]);
  const [perm, setPerm] = useState('?');
  const [fix, setFix] = useState<Fix | null>(null);
  const [facilities, setFacilities] = useState<YolpPlace[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [appid, setAppid] = useState(loadAppid);
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

  const saveAppid = (v: string) => {
    setAppid(v);
    try {
      localStorage.setItem(APPID_KEY, v);
    } catch {
      // 保存できなくても入力値はこの画面の間は使える
    }
  };

  const queryYolp = async () => {
    if (!fix) return;
    setBusy(true);
    const t0 = performance.now();
    add('YOLP 問い合わせ 半径 300m');
    try {
      const at = { lat: fix.lat, lon: fix.lon, accuracyM: fix.accuracy };
      const json = (await fetchJsonp((cb) => yolpUrl(appid.trim(), at, cb))) as {
        ResultInfo?: { Status?: unknown; Total?: unknown };
        Error?: { Message?: unknown };
      };
      if (json.Error) throw new Error(`YOLP Error: ${String(json.Error.Message)}`);
      const list = parseYolp(json);
      if (list === null) throw new Error('YOLP 応答を読めない');
      setFacilities(list);
      add(`YOLP OK ${list.length} 件 Status=${String(json.ResultInfo?.Status)} (${Math.round(performance.now() - t0)}ms)`);
    } catch (e) {
      add(`YOLP 失敗: ${errText(e)} (${Math.round(performance.now() - t0)}ms)`);
    } finally {
      setBusy(false);
    }
  };

  const accs = accuracies.current;
  const summary = accs.length ? `n=${accs.length} 最小 ${Math.min(...accs)}m / 最大 ${Math.max(...accs)}m / 直近 ${accs.join(', ')}` : '未取得';

  return (
    <main className={styles.main}>
      <a className={styles.back} href="/">← 本体へ</a>
      <h1>spike: geo</h1>
      <p>
        standalone={String(isStandalone())} / 許可状態={perm}
      </p>
      <div className={styles.row}>
        <button className={styles.button} onClick={locate}>現在地を取得</button>
        <button className={styles.button} disabled={!fix || busy || !appid.trim()} onClick={() => void queryYolp()}>
          YOLP 検索
        </button>
        <button className={styles.button} onClick={() => setLog([])}>ログ消去</button>
      </div>
      <p>accuracy: {summary}</p>
      <label>
        YOLP Client ID（この端末にだけ保存）
        <input className={styles.input} value={appid} onChange={(e) => saveAppid(e.target.value)} />
      </label>
      <p>
        左の ●/○ = 業種別半径だけの判定、右の ●/○ = 半径 + accuracy（spec/32 の判定）。公園の半径 100m は仮。
        記録に残すのは件数・accuracy・判定の内訳だけで、名前と ID は書かない（リポジトリは公開）。
      </p>
      <label>
        <input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} /> 名前と ID を表示（確認用）
      </label>
      {facilities && fix && (
        <FacilityList list={evaluate(fix, facilities)} showNames={showNames} />
      )}
      <p>
        <a className={styles.back} href={YOLP_CREDIT.href}>
          {YOLP_CREDIT.text}
        </a>
      </p>
      <h2>ログ（新しい順）</h2>
      <pre className={styles.pre}>{log.join('\n')}</pre>
    </main>
  );
}

interface Evaluated extends YolpPlace {
  /** 中心までの距離（m） */
  centerM: number;
  /** 中心からの距離 ≤ 半径 */
  inRange: boolean;
  /** 中心からの距離 ≤ 半径 + accuracy（spec/32 の判定） */
  inRangePlusAcc: boolean;
}

/** 近い順に並べ、半径だけの判定と半径 + accuracy の判定を付ける。 */
function evaluate(fix: Fix, list: readonly YolpPlace[]): Evaluated[] {
  const from = { lat: fix.lat, lon: fix.lon, accuracyM: fix.accuracy };
  const cosLat = Math.cos((fix.lat * Math.PI) / 180);
  return list
    .map((f) => {
      const centerM = distanceM(from, cosLat, f.lat, f.lon);
      return { ...f, centerM, inRange: centerM <= f.radiusM, inRangePlusAcc: centerM <= f.radiusM + fix.accuracy };
    })
    .sort((a, b) => a.centerM - b.centerM);
}

function FacilityList({ list, showNames }: { list: Evaluated[]; showNames: boolean }) {
  const inRange = list.filter((f) => f.inRange).length;
  const inRangePlusAcc = list.filter((f) => f.inRangePlusAcc).length;
  return (
    <section>
      <h2>
        YOLP: {list.length} 件（半径内 {inRange} / 半径+accuracy 内 {inRangePlusAcc}）
      </h2>
      <pre className={styles.pre}>
        {list
          .map(
            (f) =>
              `${f.inRange ? '●' : '○'}${f.inRangePlusAcc ? '●' : '○'} ${f.centerM.toFixed(0).padStart(4)}m ${f.genre}` +
              ` [半径 ${f.radiusM}m]` +
              (showNames ? ` ${f.name || '(名前なし)'} ${f.gid}` : ''),
          )
          .join('\n') || '0 件'}
      </pre>
    </section>
  );
}
