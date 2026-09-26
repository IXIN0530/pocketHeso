import { useState } from 'react';
import { describeRecord, formatFuel, planTotals, type ClaimPlan } from '../stores/activity.ts';
import styles from './activity.module.css';

/** 受け取り確認（spec/31・32）: 今回増える燃料・メダルを出してから確定する。 */
export function ConfirmModal({
  plan,
  onConfirm,
  onCancel,
}: {
  plan: ClaimPlan;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { fuelMs, medals } = planTotals(plan);
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
    <div className={styles.backdrop} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <h2>{plan.title}</h2>
        {empty ? (
          <p>今回受け取れるものはありません（その日の分は受け取り済みか、受け取れる期間を過ぎています）。</p>
        ) : (
          <>
            <p className={styles.total}>
              燃料 +{formatFuel(fuelMs)}
              {medals > 0 && ` ／ メダル +${medals}`}
            </p>
            <ul className={styles.list}>
              {plan.records.map((r) => (
                <li key={r.claimId}>
                  {describeRecord(r)}
                  {r.grant.fuelMs > 0 && ` 燃料 +${formatFuel(r.grant.fuelMs)}`}
                  {r.grant.medals > 0 && ` メダル +${r.grant.medals}`}
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
      </div>
    </div>
  );
}
