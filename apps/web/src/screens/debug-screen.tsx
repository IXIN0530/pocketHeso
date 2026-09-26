import { useState } from 'react';
import type { ClaimRecord } from '@ph/claims';
import type { AtlasVerifyResult } from '@ph/core';
import type { DebugInfo } from '../engine/engine-host.ts';
import { haptics, pack, planFor, playCue, sound } from '../fx/fx-host.ts';
import { writeClipboard } from '../platform/clipboard.ts';
import { formatFuel, localDay } from '../stores/activity.ts';
import { DEBUG_SCALES, clock } from '../stores/clock.ts';
import { debugInfo, receiveClaims, useEngine, verifyAtlas } from '../stores/engine.ts';
import { PREVIEWS, PREVIEW_SERIAL_BASE, requestPreview } from '../stores/preview.ts';
import { DEBUG_CLAIM_PREFIX } from './records-screen.tsx';
import styles from './activity.module.css';

const H = 3600000;
const GRANTS: readonly { label: string; fuelMs: number; medals: number }[] = [
  { label: '燃料 +1時間', fuelMs: H, medals: 0 },
  { label: '燃料 +12時間', fuelMs: 12 * H, medals: 0 },
  { label: 'メダル +10', fuelMs: 0, medals: 10 },
];

/** Debug の付与（台帳の1行。種類は報酬の無い「距離」にして上限・連続日数に響かせない）。 */
export function debugRecord(at: number, fuelMs: number, medals: number): ClaimRecord {
  const claimId = `${DEBUG_CLAIM_PREFIX}${crypto.randomUUID()}`;
  return {
    claimId,
    receivedAt: at,
    source: 'health',
    kind: 'distance',
    day: localDay(at),
    amount: 0,
    trust: 1,
    grant: { claimId, at, fuelMs, medals },
  };
}

const scaleHref = (x: number) => `/?debug=1${x === 1 ? '' : `&x=${x}`}`;

/** プレビューの通し番号（押すたびに進めて分岐を変える。画面を開き直しても続きから）。 */
let previewCount = 0;

/** 分岐の結果（名前=選んだ番号）。 */
function describePicks(pattern: string, picks: readonly number[]): string {
  const sheet = pack.sheets.find((s) => s.pattern === pattern);
  return sheet && picks.length > 0 ? sheet.branches.map((b, i) => `${b.name}=${picks[i]}`).join(' ') : '分岐なし';
}

/** Debug 画面（`?debug=1` のみ, spec/40）: seed・時間倍率・Grant 注入・Atlas 照合・状態ダンプ。演出テスト（音・振動）と演出プレビュー。 */
export default function DebugScreen() {
  const { projection, restoredFrom, seed } = useEngine();
  const [previewHit, setPreviewHit] = useState(false);
  const [info, setInfo] = useState<DebugInfo | null>(null);
  const [atlas, setAtlas] = useState<AtlasVerifyResult | string | null>(null);
  const [dump, setDump] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scaled = clock.scale !== 1;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const grant = (fuelMs: number, medals: number) =>
    run(async () => {
      await receiveClaims([debugRecord(clock.now(), fuelMs, medals)], false);
      setMessage(`付与しました（燃料 +${formatFuel(fuelMs)}・メダル +${medals}）`);
    });

  const check = () =>
    run(async () => {
      setAtlas('照合中…');
      const started = performance.now();
      const r = await verifyAtlas();
      setAtlas(r);
      setMessage(`Atlas 照合 ${((performance.now() - started) / 1000).toFixed(1)}秒`);
    });

  const takeDump = () =>
    run(async () => {
      const i = await debugInfo();
      setInfo(i);
      const text = JSON.stringify({ projection: useEngine.getState().projection, engine: i }, null, 1);
      setDump(text);
      setMessage((await writeClipboard(text)) ? '状態をコピーしました' : null);
    });

  return (
    <div className={styles.screen}>
      <section className={styles.card}>
        <h2>時間倍率 x{clock.scale}</h2>
        <p className={styles.note}>x60・x3600 は本番と別の DB を使います（本番のセーブには触れません）。</p>
        <div className={styles.row}>
          {DEBUG_SCALES.map((x) => (
            <a key={x} className={x === clock.scale ? styles.button : styles.sub} href={scaleHref(x)}>
              x{x}
            </a>
          ))}
        </div>
      </section>
      <section className={styles.card}>
        <h2>Grant 注入</h2>
        {scaled ? (
          <div className={styles.row}>
            {GRANTS.map((g) => (
              <button key={g.label} className={styles.sub} disabled={busy} onClick={() => void grant(g.fuelMs, g.medals)}>
                {g.label}
              </button>
            ))}
          </div>
        ) : (
          <p className={styles.note}>本番のセーブを守るため、x60・x3600 の時だけ使えます。</p>
        )}
      </section>
      <section className={styles.card}>
        <h2>演出テスト</h2>
        <p className={styles.note}>
          既定パックの test キュー（音4つ・振動・白フラッシュ）。フラッシュはホールの盤面にだけ出ます。振動{' '}
          {haptics.supported ? 'あり' : 'なし（iOS は非対応）'}。
        </p>
        <div className={styles.row}>
          <button
            className={styles.sub}
            onClick={() => {
              // iOS はタップの中で解錠する必要がある（playCue より先）。
              sound.unlock();
              playCue('test', 0, 0);
              setMessage(sound.ready ? '再生しました' : '音を準備中です。もう一度押してください');
            }}
          >
            キュー再生
          </button>
        </div>
      </section>
      <section className={styles.card}>
        <h2>演出プレビュー</h2>
        <p className={styles.note}>
          ホールの液晶で1変動を実時間で流します（Engine の抽選には触れません）。押すたびに通し番号が進み、群予告・疑似連などの分岐が変わります。
        </p>
        <label className={styles.row}>
          <input type="checkbox" checked={previewHit} onChange={(e) => setPreviewHit(e.target.checked)} />
          当たりで止める（確定は常に当たり）
        </label>
        <div className={styles.row}>
          {PREVIEWS.map((p) => (
            <button
              key={p.pattern}
              className={styles.sub}
              onClick={() => {
                // iOS はタップの中で解錠する必要がある。
                sound.unlock();
                const serial = PREVIEW_SERIAL_BASE + previewCount++;
                const plan = planFor(p.pattern, seed, serial, 1, 1);
                requestPreview({ pattern: p.pattern, hit: p.alwaysHit === true || previewHit, serial, color: p.color });
                setMessage(`${p.label} #${serial - PREVIEW_SERIAL_BASE}: ${describePicks(p.pattern, plan.picks)}`);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>
      <section className={styles.card}>
        <h2>Engine</h2>
        <dl className={styles.facts}>
          <dt>復元</dt>
          <dd>{restoredFrom === 'snapshot' ? 'スナップショット' : restoredFrom === 'recompute' ? '再計算' : '—'}</dd>
          <dt>時刻</dt>
          <dd>{projection ? new Date(projection.at).toLocaleString('ja-JP') : '—'}</dd>
          {info && (
            <>
              <dt>seed</dt>
              <dd>{info.meta.seed}</dd>
              <dt>機種</dt>
              <dd>{info.meta.machineId}</dd>
              <dt>開始</dt>
              <dd>{new Date(info.meta.createdAt).toLocaleString('ja-JP')}</dd>
              <dt>入力</dt>
              <dd>
                Grant {info.grants} / Action {info.actions}
              </dd>
            </>
          )}
        </dl>
        <div className={styles.row}>
          <button className={styles.sub} disabled={busy} onClick={() => void takeDump()}>
            状態ダンプ（コピー）
          </button>
          <button className={styles.sub} disabled={busy} onClick={() => void check()}>
            Atlas 照合
          </button>
        </div>
        {atlas !== null && (
          <p className={typeof atlas !== 'string' && atlas.mismatched > 0 ? styles.error : styles.note}>
            {typeof atlas === 'string' ? atlas : `照合 ${atlas.checked}件・不一致 ${atlas.mismatched}件・ヘソ ${atlas.heso}件`}
          </p>
        )}
        {dump !== null && <textarea className={styles.textarea} readOnly value={dump} rows={10} />}
      </section>
      <section className={styles.card}>
        <h2>演出プレビュー</h2>
        <p className={styles.note}>P6（音・光・振動）で追加します。</p>
      </section>
      {message && <p className={styles.note}>{message}</p>}
    </div>
  );
}
