import { useEffect, useRef, useState } from 'react';

const DURATION_MS = 600;
const reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/** 数値が変わったら前の値から新しい値へ数え上げて見せる（1Hz の更新をなめらかにする）。 */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    if (start === value || !Number.isFinite(start) || !Number.isFinite(value) || reducedMotion?.matches) {
      from.current = value;
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / DURATION_MS);
      const eased = 1 - (1 - t) * (1 - t) * (1 - t);
      const n = start + (value - start) * eased;
      from.current = n;
      setShown(t < 1 ? n : value);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <>{format(shown)}</>;
}
