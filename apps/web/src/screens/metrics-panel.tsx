import { useEffect, useState } from 'react';
import type { DebugInfo } from '../engine/engine-host.ts';
import type { Metrics } from '../engine/metrics.ts';
import { debugInfo, resetMetrics } from '../stores/engine.ts';
import { formatNum, formatSpan, formatTime } from '../stores/format.ts';
import styles from './activity.module.css';

/** 計測の時間: 10ms 未満は小数1桁。 */
export function formatMs(ms: number): string {
  return `${ms < 10 ? ms.toFixed(1) : formatNum(Math.round(ms))}ms`;
}

export function formatBytes(b: number | null): string {
  if (b === null) {
    return '非対応';
  }
  if (b >= 1024 * 1024) {
    return `${(b / (1024 * 1024)).toFixed(2)}MB`;
  }
  return b >= 1024 ? `${(b / 1024).toFixed(1)}KB` : `${b}B`;
}

/** 起動の要約（時刻・復元元・全体（読込・追いつき）・追いついた時間・入力件数）。 */
export function describeBoot(b: Metrics['boots'][number], now: number): string {
  const from = b.from === 'snapshot' ? 'スナップショット' : '再計算';
  return `${formatTime(b.at, now)} ${from} ${formatMs(b.totalMs)}（読込 ${formatMs(b.loadMs)}・追いつき ${formatMs(b.catchUpMs)}）${formatSpan(b.spanMs)}ぶん・入力 ${formatNum(b.inputs)}件`;
}

/** Debug のローカル計測ログ（P7-T1）: 起動時の追いつき・advance・IndexedDB の大きさ・受け取り回数。 */
export function MetricsPanel({ now }: { readonly now: number }) {
  const [info, setInfo] = useState<DebugInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    debugInfo().then(
      (i) => {
        setInfo(i);
        setError(null);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );

  useEffect(() => {
    void load();
  }, []);

  const reset = () =>
    resetMetrics().then(
      () => load(),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );

  const m = info?.metrics;
  const a = m?.advance;
  const slowest = m?.boots.reduce((x, b) => Math.max(x, b.catchUpMs), 0) ?? 0;
  return (
    <section className={styles.card}>
      <h2>計測ログ</h2>
      <p className={styles.note}>この端末の中だけに残します（セーブの書き出しには含めません）。</p>
      {error && <p className={styles.error}>{error}</p>}
      {m && a && info && (
        <dl className={styles.facts}>
          <dt>起動</dt>
          <dd>{m.boots[0] ? describeBoot(m.boots[0], now) : '—'}</dd>
          <dt>追いつき最大</dt>
          <dd>
            {formatMs(slowest)}（{m.boots.length}回中）
          </dd>
          <dt>advance</dt>
          <dd>
            {a.count > 0
              ? `${formatNum(a.count)}回・平均 ${formatMs(a.totalMs / a.count)}・最大 ${formatMs(a.maxMs)}・直近 ${formatMs(a.lastMs)}`
              : '—'}
            （{formatTime(a.since, now)} から）
          </dd>
          <dt>IndexedDB</dt>
          <dd>
            今 {formatBytes(info.dbBytes)}
            {m.boots[0] && `・起動時 ${formatBytes(m.boots[0].dbBytes)}`}（Grant {formatNum(info.grants)}・Action {formatNum(info.actions)}）
          </dd>
          <dt>受け取り</dt>
          <dd>
            {formatNum(m.receives.count)}回・{formatNum(m.receives.claims)}行
            {m.receives.lastAt !== null && `（最後 ${formatTime(m.receives.lastAt, now)}）`}
          </dd>
        </dl>
      )}
      {m && m.boots.length > 1 && (
        <details>
          <summary>起動の履歴（{m.boots.length}回）</summary>
          <ul className={styles.list}>
            {m.boots.map((b, i) => (
              <li key={`${b.at}-${i}`} className={styles.note}>
                {describeBoot(b, now)}・{formatBytes(b.dbBytes)}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className={styles.row}>
        <button className={styles.sub} onClick={() => void load()}>
          更新
        </button>
        <button className={styles.sub} onClick={() => void reset()}>
          計測をリセット
        </button>
      </div>
    </section>
  );
}
