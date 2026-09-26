import { useEffect, useRef, type ReactNode } from 'react';
import { tick } from '../platform/haptic.ts';

/** 長押しで連続して押したことにするまでの時間と、連続の間隔（だんだん速くなる）。 */
export const HOLD_DELAY_MS = 420;
export const FIRST_INTERVAL_MS = 220;
export const MIN_INTERVAL_MS = 70;

/**
 * 長押しの連続: `canContinue` が true の間 `fire` を呼び、間隔を 0.8 倍ずつ（下限あり）縮めて待つ。
 * 呼んだ回数を返す。
 */
export async function repeatWhile(canContinue: () => boolean, fire: () => Promise<void>, wait: (ms: number) => Promise<void>): Promise<number> {
  let interval = FIRST_INTERVAL_MS;
  let count = 0;
  while (canContinue()) {
    await fire();
    count += 1;
    await wait(interval);
    interval = Math.max(MIN_INTERVAL_MS, interval * 0.8);
  }
  return count;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * タップで1回、長押しで連続して `onFire` を呼ぶボタン（強化のまとめ買い）。
 * 次の呼び出しは前の `onFire` が終わってから（連打しても重ねない）。押せなくなったら（disabled）止まる。
 */
export function HoldButton({
  onFire,
  disabled,
  className,
  children,
}: {
  onFire: () => Promise<void>;
  disabled: boolean;
  className?: string | undefined;
  children: ReactNode;
}) {
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const inFlight = useRef(false);
  const fire = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await onFire();
    } finally {
      inFlight.current = false;
    }
  };
  const hold = useRef<{ timer: ReturnType<typeof setTimeout> | null; repeating: boolean; stop: boolean } | null>(null);

  const stop = () => {
    const h = hold.current;
    if (h === null) return;
    h.stop = true;
    if (h.timer !== null) clearTimeout(h.timer);
  };
  useEffect(() => stop, []);

  const start = () => {
    stop();
    const h = { timer: null as ReturnType<typeof setTimeout> | null, repeating: false, stop: false };
    hold.current = h;
    h.timer = setTimeout(() => {
      h.repeating = true;
      void repeatWhile(
        () => !h.stop && !disabledRef.current,
        () => {
          tick();
          return fire();
        },
        sleep,
      );
    }, HOLD_DELAY_MS);
  };

  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        // 長押しで連続した後の click は1回分として数えない。
        if (hold.current?.repeating) return;
        stop();
        if (inFlight.current) return;
        tick();
        void fire();
      }}
    >
      {children}
    </button>
  );
}
