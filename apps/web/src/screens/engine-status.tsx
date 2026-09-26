import { useEngine } from '../stores/engine.ts';
import styles from './activity.module.css';

/** Engine の状態（HUD はホール、留守中サマリーはモーダル）: 起動中・エラー・時計の巻き戻し。 */
export function EngineStatus() {
  const { status, error, clockBack } = useEngine();
  return (
    <>
      {status === 'booting' && <p className={styles.note}>ゲームを復元中…</p>}
      {error !== null && <p className={styles.error}>ゲームの処理でエラー: {error}</p>}
      {clockBack && (
        <p className={styles.error}>
          端末の時計が前回より戻っています。ゲームを止めています（時計を正しく戻すと再開します）。
        </p>
      )}
    </>
  );
}
