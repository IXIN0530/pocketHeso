import { useEffect } from 'react';
import { Sheet } from '../components/sheet.tsx';
import { sound } from '../fx/fx-host.ts';
import { AWAY_BANNER_MS, awayBannerLines } from '../stores/away.ts';
import { dismissAway, dismissAwayBanner, openAwayFromBanner, useEngine } from '../stores/engine.ts';
import { formatNum, formatSpan, formatTime } from '../stores/format.ts';
import { replayRequest, requestPreview } from '../stores/preview.ts';
import styles from './activity.module.css';

/**
 * 留守中サマリー（spec/40）: 復帰時に経過時間・獲得玉・大当たり・燃料切れ時刻を出す。
 * 「最も熱い当たりを見る」はホールの液晶で Engine が決めた変動のままリプレイする（spec/22 AwaySummary）。
 */
export function AwayModal() {
  const away = useEngine((s) => s.away);
  const fuelMs = useEngine((s) => s.projection?.fuelMs ?? 0);
  const autoOpenedAt = useEngine((s) => s.autoOpenedAt);
  if (away === null) {
    return null;
  }
  const replay = replayRequest(away);
  const autoOpened = autoOpenedAt !== null && autoOpenedAt >= away.from && autoOpenedAt <= away.to;
  return (
    <Sheet onDismiss={dismissAway} labelledBy="away-title">
      <h2 id="away-title">留守のあいだ（{formatSpan(away.to - away.from)}）</h2>
      {autoOpened && <p className={styles.note}>自動で開店しました</p>}
      <p className={styles.total}>+{formatNum(away.gainedBalls)}玉</p>
      <dl className={styles.facts}>
        <dt>大当たり</dt>
        <dd>{away.jackpots}回</dd>
        {away.maxChain > 1 && (
          <>
            <dt>最大連チャン</dt>
            <dd>
              {away.maxChain}連（{formatNum(away.maxChainBalls)}玉）
            </dd>
          </>
        )}
        {away.achievements > 0 && (
          <>
            <dt>実績</dt>
            <dd>+{away.achievements}</dd>
          </>
        )}
        <dt>燃料</dt>
        <dd>{away.fuelEmptyAt !== null ? `${formatTime(away.fuelEmptyAt, away.to)} に切れました` : fuelMs > 0 ? '最後まで持ちました' : '切れたままでした'}</dd>
      </dl>
      {(away.fuelEmptyAt !== null || fuelMs === 0) && <p className={styles.note}>燃料が切れると生産はごくわずかになります。行動タブで運動を受け取ると補給できます。</p>}
      <div className={styles.row}>
        {replay && (
          <button
            className={styles.button}
            onClick={() => {
              // iOS はタップの中で音を解錠する必要がある。
              sound.unlock();
              requestPreview(replay);
              dismissAway();
            }}
          >
            最も熱い当たりを見る（{formatTime(replay.replayAt ?? away.to, away.to)}）
          </button>
        )}
        <button className={replay ? styles.sub : styles.button} onClick={dismissAway}>
          閉じる
        </button>
      </div>
    </Sheet>
  );
}

/** 5分以上の留守を知らせるバナー（P11-T1）。操作不要で数秒で消え、タップで詳細のシートを開く。音・触覚は鳴らさない。 */
export function AwayBanner() {
  const banner = useEngine((s) => s.awayBanner);
  const autoOpenedAt = useEngine((s) => s.autoOpenedAt);
  useEffect(() => {
    if (banner === null) return;
    const id = setTimeout(dismissAwayBanner, AWAY_BANNER_MS);
    return () => clearTimeout(id);
  }, [banner]);
  if (banner === null) {
    return null;
  }
  const lines = [...awayBannerLines(banner)];
  // 休業中に30分たって自動で開店していたら留守バナーに含める（P12-T3）。
  if (autoOpenedAt !== null && autoOpenedAt >= banner.from && autoOpenedAt <= banner.to) {
    lines.push('自動で開店しました');
  }
  return (
    <button className={styles.awayBanner} onClick={openAwayFromBanner} role="status">
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </button>
  );
}
