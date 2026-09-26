import { act, dismissAway, useEngine } from '../stores/engine.ts';
import { formatFuel } from '../stores/activity.ts';
import styles from './activity.module.css';

/** 打つ/止める（P5-T3 のトグルとレート選択までの仮。盤面の玉を確かめるため）。 */
const shoot = (on: boolean) => void act({ k: 'shoot', on, rate: 1 }).catch((e: unknown) => useEngine.setState({ error: String(e) }));

/** Engine の状態（P5-T3 の HUD までの最小表示）: 起動中・エラー・時計の巻き戻し・留守中サマリー。 */
export function EngineStatus() {
  const { status, error, clockBack, away, projection } = useEngine();
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
      {projection !== null && (
        <>
          <p className={styles.note}>
            持ち玉 {Math.floor(projection.balls).toLocaleString('ja-JP')}・回転 {projection.totals.spins}・大当たり {projection.totals.jackpots}
          </p>
          <div className={styles.row}>
            <button className={styles.sub} onClick={() => shoot(true)}>
              打つ
            </button>
            <button className={styles.sub} onClick={() => shoot(false)}>
              止める
            </button>
          </div>
        </>
      )}
    </>
  );
}
