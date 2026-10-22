import { useState } from 'react';
import { Sheet } from '../components/sheet.tsx';
import { describeRecord, formatFuel, formatProd, planTotals, projectBalls, type ClaimPlan } from '../stores/activity.ts';
import { formatNum } from '../stores/format.ts';
import styles from './activity.module.css';

/** 1行の内訳（即時の玉・燃料・メダル・特別保留）。 */
function grantText(g: { fuelMs: number; medals: number; prodMin?: number | undefined; bonusHolds?: number | undefined; goldHolds?: number | undefined }): string {
  const parts: string[] = [];
  if ((g.prodMin ?? 0) > 0) parts.push(`玉 生産${formatProd(g.prodMin ?? 0)}ぶん`);
  if (g.fuelMs > 0) parts.push(`燃料 +${formatFuel(g.fuelMs)}`);
  if (g.medals > 0) parts.push(`メダル +${g.medals}`);
  if ((g.bonusHolds ?? 0) > 0) parts.push(`特別保留 +${g.bonusHolds}`);
  if ((g.goldHolds ?? 0) > 0) parts.push(`金保留 +${g.goldHolds}（Debug）`);
  return parts.length === 0 ? '' : ` ${parts.join(' ')}`;
}

/**
 * 受け取り確認（spec/31・32・40）: 今回増える玉（生産◯時間ぶん ≈ ◯玉）・燃料・メダル・特別保留を出してから確定する。
 * 玉の見込みは受け取り時点の基準生産（Projection の refPerSec）。確定値は granted の balls（トースト）。
 */
export function ConfirmModal({
  plan,
  refPerSec,
  onConfirm,
  onCancel,
}: {
  plan: ClaimPlan;
  refPerSec: number | null;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { fuelMs, medals, prodMin, bonusHolds } = planTotals(plan);
  const empty = plan.records.length === 0;

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } catch (e) {
      setError(`保存できませんでした: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
    }
  };

  return (
    // 下へ引いて閉じるのは「やめる」と同じ（受け取るものが無い時は「閉じる」と同じ）。
    <Sheet onDismiss={busy ? undefined : empty ? () => void confirm() : onCancel} labelledBy="confirm-title">
      <h2 id="confirm-title">{plan.title}</h2>
      {empty ? (
        <p>今回受け取れるものはありません（その日の分は受け取り済みか、受け取れる期間を過ぎています）。</p>
      ) : (
        <>
          {prodMin > 0 && (
            <p className={styles.total}>
              玉 生産{formatProd(prodMin)}ぶん
              {refPerSec !== null && ` ≈ ${formatNum(projectBalls(prodMin, refPerSec))}玉`}
            </p>
          )}
          {(fuelMs > 0 || medals > 0 || bonusHolds > 0 || prodMin === 0) && (
            <p className={styles.total}>
              {[
                (fuelMs > 0 || prodMin === 0) && `燃料 +${formatFuel(fuelMs)}`,
                medals > 0 && `メダル +${medals}`,
                bonusHolds > 0 && `特別保留 +${bonusHolds}`,
              ]
                .filter(Boolean)
                .join(' ／ ')}
            </p>
          )}
          <ul className={styles.list}>
            {plan.records.map((r) => (
              <li key={r.claimId}>
                {describeRecord(r)}
                {grantText(r.grant)}
              </li>
            ))}
          </ul>
        </>
      )}
      {plan.warnings.map((w) => (
        <p key={w} className={styles.note}>
          注意: {w}
        </p>
      ))}
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.row}>
        <button className={styles.button} disabled={busy} onClick={() => void confirm()}>
          {empty ? '閉じる' : '確定'}
        </button>
        {!empty && (
          <button className={styles.sub} disabled={busy} onClick={onCancel}>
            やめる
          </button>
        )}
      </div>
    </Sheet>
  );
}
