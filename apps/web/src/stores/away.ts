// 留守サマリーの出し分け（spec/40）: 短い留守は出さず、5分以上はタップ不要のバナーにする。
import type { AwaySummary } from '@ph/core';
import { formatNum, formatSpan, formatTime } from './format.ts';

/** これ未満の留守は何も出さない。 */
export const AWAY_NOTICE_MIN_MS = 5 * 60_000;

/** バナーを出しておく時間。 */
export const AWAY_BANNER_MS = 5000;

export function shouldNoticeAway(away: AwaySummary): boolean {
  return away.to - away.from >= AWAY_NOTICE_MIN_MS;
}

/** バナーの文言（1〜2行）: 「留守 2時間13分  +1.23億玉・大当たり3回」＋実績・燃料切れ。 */
export function awayBannerLines(away: AwaySummary): readonly string[] {
  const parts = [`+${formatNum(away.gainedBalls)}玉`, `大当たり${away.jackpots}回`];
  if (away.achievements > 0) {
    parts.push(`実績 +${away.achievements}`);
  }
  const lines = [`留守 ${formatSpan(away.to - away.from)}  ${parts.join('・')}`];
  if (away.fuelEmptyAt !== null) {
    lines.push(`燃料 ${formatTime(away.fuelEmptyAt, away.to)} に切れました`);
  }
  return lines;
}
