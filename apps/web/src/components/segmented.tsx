import type { CSSProperties } from 'react';
import { tick } from '../platform/haptic.ts';
import styles from './segmented.module.css';

/** iOS のセグメンテッドコントロール: 選んだ項目の下に白い板が滑る。 */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  disabled = false,
}: {
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
}) {
  const index = options.findIndex(([v]) => v === value);
  return (
    <div
      className={styles.segmented}
      role="radiogroup"
      aria-label={label}
      style={{ '--n': options.length, '--i': Math.max(0, index) } as CSSProperties}
    >
      {index >= 0 && <span className={styles.thumb} aria-hidden="true" />}
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={v === value}
          disabled={disabled}
          onClick={() => {
            if (v === value) return;
            tick();
            onChange(v);
          }}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
