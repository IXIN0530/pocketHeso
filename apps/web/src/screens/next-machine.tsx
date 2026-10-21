import { MACHINE_INFO, machineLine } from '../engine/machine-info.ts';
import styles from './tree.module.css';

export interface NextMachineProps {
  /** 今の台。 */
  readonly current: string;
  /** 休業中に選んだ次の台（未選択は null）。 */
  readonly picked: string | null;
  /** 選べる台（Projection.machinesOpen）。 */
  readonly open: readonly string[];
  /** RUSH 中に閉店していた（切り替えで捨てるものが大きい）。 */
  readonly strong?: boolean;
  readonly onPick: (id: string) => void;
  /** 未開放の店の鍵から、開放するノードを見に行く。 */
  readonly onGoNode: (node: string) => void;
}

/** 休業のシートの「次に打つ台」（P14-T2）: 3店を縦に並べ、開店で選んだ台に切り替わる。 */
export function NextMachine({ current, picked, open, strong = false, onPick, onGoNode }: NextMachineProps) {
  const next = picked ?? current;
  return (
    <section className={styles.machines} aria-label="次に打つ台">
      <h3>次に打つ台</h3>
      <ul className={styles.list}>
        {MACHINE_INFO.map((m) => {
          const unlocked = open.includes(m.id);
          const label = m.id === current ? 'いま' : m.id === next ? '開店から' : null;
          const inner = (
            <>
              <span className={styles.info}>
                <b>
                  {m.shop} {m.name}
                  {label !== null && <small className={styles.timing}> {label}</small>}
                </b>
                <small>{unlocked ? m.blurb : '🔒 常連ツリー 段1・5P で開放'}</small>
                <small>{machineLine(m.id)}</small>
              </span>
            </>
          );
          return (
            <li key={m.id}>
              {unlocked || m.node === null ? (
                <button type="button" className={`${styles.row} ${styles.machine} ${m.id === next ? styles.picked : ''}`} aria-pressed={m.id === next} onClick={() => onPick(m.id)}>
                  {inner}
                </button>
              ) : (
                <button type="button" className={`${styles.row} ${styles.machine} ${styles.locked}`} onClick={() => onGoNode(m.node as string)}>
                  {inner}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {next !== current && <p className={strong ? styles.warnStrong : styles.sub}>台が変わると、保留と電サポ・大当たりの残りは消えます{strong ? '（RUSH 中でした）' : ''}。</p>}
    </section>
  );
}
