import { dismissAway, useEngine } from '../stores/engine.ts';
import { formatFuel } from '../stores/activity.ts';
import styles from './activity.module.css';

/** Engine の状態（HUD はホール）: 起動中・エラー・時計の巻き戻し・留守中サマリー（P5-T4 でモーダルに）。 */
export function EngineStatus() {
  const { status, error, clockBack, away } = useEngine();
  return (
    <>
      {status === 'booting' && <p className={styles.note}>ゲームを復元中…</p>}
      {error !== null && <p className={styles.error}>ゲームの処理でエラー: {error}</p>}
      {clockBack && (
        <p className={styles.error}>
          端末の時計が前回より戻っています。ゲームを止めています（時計を正しく戻すと再開します）。
        </p>
      )}
      {away !== null && (
        <section className={styles.card}>
          <h2>留守のあいだ</h2>
          <p>
            {formatFuel(away.to - away.from)}の間に +{Math.floor(away.gainedBalls).toLocaleString('ja-JP')}玉・大当たり {away.jackpots}回
            {away.fuelEmptyAt !== null && '（途中で燃料切れ）'}
          </p>
          <div className={styles.row}>
            <button className={styles.sub} onClick={dismissAway}>
              閉じる
            </button>
          </div>
        </section>
      )}
    </>
  );
}
