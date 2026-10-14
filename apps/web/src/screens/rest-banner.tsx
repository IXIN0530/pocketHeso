import { useEffect, useState } from 'react';
import type { RestView } from '@ph/core';
import { playToastCue } from '../fx/fx-host.ts';
import { act, dismissAutoOpened, useEngine } from '../stores/engine.ts';
import { formatNum } from '../stores/format.ts';
import styles from './activity.module.css';

let cueSerial = 1000;
const report = (e: unknown) => useEngine.setState({ error: e instanceof Error ? e.message : String(e) });

/** 帯の文言（テスト用に純粋関数で出す）。 */
export function restBannerLines(rest: RestView): readonly string[] {
  const lines = ['休業中　開店する ›'];
  if (rest.pendingBalls > 0) {
    lines.push(`開店時に +${formatNum(rest.pendingBalls)}玉`);
  }
  return lines;
}

/** 休業中かどうか（帯の表示条件）。 */
export function shouldShowRestBanner(rest: RestView | null | undefined): rest is RestView {
  return rest !== null && rest !== undefined;
}

/**
 * 休業中の帯（P12-T3）: どのタブでもタブバーの上に出し、タップで開店する。
 * 休業中の行動の玉は「開店時に +n玉」と出す。開店は普通のボタンと同じ Action `open`。
 */
export function RestBanner() {
  const rest = useEngine((s) => s.projection?.rest ?? null);
  const [busy, setBusy] = useState(false);
  if (!shouldShowRestBanner(rest)) {
    return null;
  }
  return (
    <button
      className={styles.awayBanner}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        act({ k: 'open' })
          .then(() => playToastCue('opened', useEngine.getState().seed, ++cueSerial))
          .catch(report)
          .finally(() => setBusy(false));
      }}
      role="status"
      aria-label="休業中。タップで開店する"
    >
      {restBannerLines(rest).map((line) => (
        <span key={line}>{line}</span>
      ))}
    </button>
  );
}

/** 自動開店のバナー（P12-T3）: 「自動で開店しました」。留守バナーがある時は留守バナーに含めるので出さない。 */
export function AutoOpenedBanner() {
  const autoOpenedAt = useEngine((s) => s.autoOpenedAt);
  const awayBanner = useEngine((s) => s.awayBanner);
  useEffect(() => {
    if (autoOpenedAt === null) return;
    // 前面で自動開店した時は短い演出も（留守から戻った時はバナーのみ）。
    if (awayBanner === null) {
      playToastCue('opened', useEngine.getState().seed, ++cueSerial);
    }
    const id = setTimeout(dismissAutoOpened, 5000);
    return () => clearTimeout(id);
  }, [autoOpenedAt, awayBanner]);
  if (autoOpenedAt === null || awayBanner !== null) {
    return null;
  }
  return (
    <button className={styles.awayBanner} onClick={dismissAutoOpened} role="status">
      <span>自動で開店しました</span>
    </button>
  );
}
