import type { ReactNode } from 'react';
import styles from './switch.module.css';

/** iOS のスイッチ（Safari の `<input type="checkbox" switch>`。触覚はシステムが出す）。 */
export function Switch({
  checked,
  onChange,
  disabled = false,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={styles.row}>
      <span className={styles.text}>{children}</span>
      <input type="checkbox" switch="" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
