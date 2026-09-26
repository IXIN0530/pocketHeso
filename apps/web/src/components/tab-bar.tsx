import type { CSSProperties } from 'react';
import { tick } from '../platform/haptic.ts';
import styles from './tab-bar.module.css';

/** タブの絵（24px の線画。SF Symbols の雰囲気に寄せた自作）。 */
const ICONS: Readonly<Record<string, string>> = {
  hall: 'M7 2.5h10a3 3 0 0 1 3 3v13a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-13a3 3 0 0 1 3-3zM12 5.5a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM8.5 17.5h7',
  shop: 'M13 2.5 4.5 13.5h6.5l-1 8 8.5-11h-6.5z',
  activity: 'M2.5 12.5h4l2.5-6 5 11 2.5-5h5',
  records: 'M5 20.5v-8M12 20.5v-17M19 20.5v-11',
  settings: 'M3.5 7h9M18.5 7h2M3.5 17h2M11.5 17h9M15.5 4.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5zM8.5 14.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z',
  debug: 'M8 6.5 2.5 12 8 17.5M16 6.5l5.5 5.5-5.5 5.5M13.5 4.5l-3 15',
};

/** 下部タブ（spec/40）: iOS 26 の浮いたすりガラスのタブバー。選んだタブの下に板が滑る。今のタブを押しても onChange を呼ぶ。 */
export function TabBar<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly (readonly [T, string])[];
  value: T;
  onChange: (tab: T) => void;
}) {
  const index = tabs.findIndex(([id]) => id === value);
  return (
    <nav className={styles.bar} role="tablist" style={{ '--n': tabs.length, '--i': Math.max(0, index) } as CSSProperties}>
      <span className={styles.thumb} aria-hidden="true" />
      {tabs.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={id === value}
          onClick={() => {
            if (id !== value) tick();
            onChange(id);
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={ICONS[id] ?? ''} />
          </svg>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
