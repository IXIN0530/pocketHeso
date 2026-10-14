import { useEffect, useState } from 'react';
import type { ClaimRecord } from '@ph/claims';
import type { AchievementMetric, AchievementsView } from '@ph/core';
import { ACHIEVEMENTS } from '../engine/achievement-defs.ts';
import { loadLedger, openStorage } from '../platform/storage.ts';
import { METRIC_LABEL, achievedCount, achievedDateLabel, groupAchievements, multPercent, progressPercent } from '../stores/achievements.ts';
import { describeRecord, formatFuel, formatProd } from '../stores/activity.ts';
import { clock, dbNameFor } from '../stores/clock.ts';
import { useEngine } from '../stores/engine.ts';
import { formatNum, formatTime } from '../stores/format.ts';
import styles from './activity.module.css';

/** 記録に出す日数。 */
export const RECORD_DAYS = 14;

export interface DayRecord {
  readonly day: string;
  readonly fuelMs: number;
  readonly medals: number;
  /** 即時の玉（生産◯分ぶん。玉数は受け取り時の基準生産で決まり台帳に残らない）。 */
  readonly prodMin: number;
  readonly bonusHolds: number;
  readonly lines: readonly string[];
}

/** Debug 画面の付与（claimId の頭）。 */
export const DEBUG_CLAIM_PREFIX = 'debug-';

/** 台帳を日別にまとめる（新しい日から days 日分）。 */
export function groupByDay(ledger: readonly ClaimRecord[], days = RECORD_DAYS): DayRecord[] {
  const map = new Map<string, { fuelMs: number; medals: number; prodMin: number; bonusHolds: number; lines: string[] }>();
  for (const r of ledger) {
    const d = map.get(r.day) ?? { fuelMs: 0, medals: 0, prodMin: 0, bonusHolds: 0, lines: [] };
    d.fuelMs += r.grant.fuelMs;
    d.medals += r.grant.medals;
    d.prodMin += r.grant.prodMin ?? 0;
    d.bonusHolds += r.grant.bonusHolds ?? 0;
    d.lines.push(r.claimId.startsWith(DEBUG_CLAIM_PREFIX) ? 'Debug の付与' : describeRecord(r).replace(/^\d+\/\d+ /, ''));
    map.set(r.day, d);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, days)
    .map(([day, d]) => ({ day, ...d }));
}

const dayLabel = (day: string) => {
  const [, m, d] = day.split('-');
  return `${Number(m)}/${Number(d)}`;
};

/** 指標の値（基準生産/秒だけ小数1桁）。 */
const metricNum = (metric: AchievementMetric, n: number) => formatNum(n, metric === 'refPerSec' ? 1 : 0);

/** 実績（spec/24 画面）: 達成数と生産 +n%、指標ごとに達成済み・次の1つの進捗・伏せた先。 */
function AchievementsCard({ view }: { view: AchievementsView }) {
  const groups = groupAchievements(view, ACHIEVEMENTS.list);
  return (
    <section className={styles.card}>
      <h2>
        実績 {achievedCount(view, ACHIEVEMENTS.list)} / {ACHIEVEMENTS.list.length}・生産 +{multPercent(view.mult)}%
      </h2>
      <ul className={styles.list}>
        {groups.map((g) => (
          <li key={g.metric} className={styles.achGroup}>
            <small className={styles.note}>{METRIC_LABEL[g.metric]}</small>
            {g.done.map((d) => (
              <span key={d.id} className={styles.achDone}>
                <b>★ {d.name}</b>
                <small className={styles.note}>{achievedDateLabel(d.at)}</small>
              </span>
            ))}
            {g.next && (
              <span className={styles.achNext}>
                <span className={styles.achLine}>
                  <span>☆ {g.next.name}</span>
                  <b className={styles.achPct}>{progressPercent(g.next.ratio)}%</b>
                </span>
                <span className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent(g.next.ratio)}>
                  <span style={{ width: `${progressPercent(g.next.ratio)}%` }} />
                </span>
                <small className={styles.note}>
                  {metricNum(g.metric, g.next.value)} / {metricNum(g.metric, g.next.at)}
                </small>
              </span>
            )}
            {g.hidden > 0 && <small className={styles.note}>{'？？？ '.repeat(g.hidden).trim()}</small>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 記録画面（spec/40）: 実績、パチンコ統計、閉店履歴、日別の行動と獲得。 */
export function RecordsScreen() {
  const p = useEngine((s) => s.projection);
  const [days, setDays] = useState<DayRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    openStorage(dbNameFor(clock.scale))
      .then(async (db) => {
        const ledger = await loadLedger(db);
        db.close();
        if (alive) setDays(groupByDay(ledger));
      })
      .catch((e: unknown) => setError(`記録を読めません: ${e instanceof Error ? e.message : String(e)}`));
    return () => {
      alive = false;
    };
  }, []);

  const t = p?.totals;
  return (
    <div className={styles.screen}>
      {p && <AchievementsCard view={p.achievements} />}
      {t && (
        <section className={styles.card}>
          <h2>パチンコ</h2>
          <dl className={styles.facts}>
            <dt>回転数</dt>
            <dd>{formatNum(t.spins)}</dd>
            <dt>初当たり</dt>
            <dd>
              {formatNum(t.firstHits)}回{t.firstHits > 0 && `（1/${formatNum(t.spins / t.firstHits, 1)}）`}
            </dd>
            <dt>大当たり</dt>
            <dd>{formatNum(t.jackpots)}回</dd>
            <dt>最大連チャン</dt>
            <dd>{t.maxChain > 0 ? `${t.maxChain}連` : '—'}</dd>
            <dt>発射</dt>
            <dd>{formatNum(t.fired)}発</dd>
            <dt>出玉</dt>
            <dd>{formatNum(t.payoutBalls)}玉</dd>
          </dl>
        </section>
      )}
      {p && (
        <section className={styles.card}>
          <h2>閉店</h2>
          {p.closes.length === 0 ? (
            <p className={styles.note}>まだ閉店していません。</p>
          ) : (
            <ul className={styles.list}>
              {[...p.closes].reverse().map((c) => (
                <li key={c.at}>
                  {formatTime(c.at, p.at)} 今回 {formatNum(c.runTotal)}玉 → 常連ランク +{c.gain}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section className={styles.card}>
        <h2>行動と獲得（{RECORD_DAYS}日）</h2>
        {error && <p className={styles.error}>{error}</p>}
        {days === null && error === null && <p className={styles.note}>読み込み中…</p>}
        {days?.length === 0 && <p className={styles.note}>まだ記録がありません。行動タブで運動を受け取ると増えます。</p>}
        {days && days.length > 0 && (
          <ul className={styles.list}>
            {days.map((d) => (
              <li key={d.day}>
                <b>{dayLabel(d.day)}</b>
                {d.prodMin > 0 && ` 玉 生産${formatProd(d.prodMin)}ぶん ・`} 燃料 +{formatFuel(d.fuelMs)}
                {d.medals > 0 && ` ・メダル +${d.medals}`}
                {d.bonusHolds > 0 && ` ・特別保留 +${d.bonusHolds}`}
                <br />
                <small className={styles.note}>{d.lines.join(' / ')}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
