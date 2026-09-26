import { useEffect, useRef, useState, type ReactNode } from 'react';
import { tick } from '../platform/haptic.ts';
import styles from './sheet.module.css';

/** 指を離した時に閉じる距離と速さ（下向き）。 */
const CLOSE_PX = 110;
const CLOSE_PX_PER_MS = 0.6;
const LEAVE_MS = 240;

/**
 * 下から出るシート（iOS のモーダル）。つまみや中身を下へ引くか、背景をタップすると `onDismiss`。
 * `onDismiss` が無い間（処理中など）は閉じない。中身がスクロールしている時は先にスクロールを戻す。
 */
export function Sheet({ onDismiss, labelledBy, children }: { onDismiss?: (() => void) | undefined; labelledBy?: string; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  const leave = () => {
    const done = dismissRef.current;
    if (done === undefined || leaving) return;
    setLeaving(true);
    setTimeout(done, LEAVE_MS);
  };
  const leaveRef = useRef(leave);
  leaveRef.current = leave;

  // touchmove で preventDefault するため passive: false で直接付ける。
  useEffect(() => {
    const el = panel.current;
    const bg = backdrop.current;
    if (el === null || bg === null) return;
    let startY = 0;
    let lastY = 0;
    let lastT = 0;
    let speed = 0;
    let dragging = false;

    const move = (dy: number) => {
      el.style.transition = 'none';
      el.style.transform = `translateY(${dy}px)`;
      bg.style.transition = 'none';
      bg.style.opacity = String(1 - Math.min(1, dy / el.offsetHeight));
    };
    const reset = () => {
      el.style.transition = '';
      el.style.transform = '';
      bg.style.transition = '';
      bg.style.opacity = '';
    };

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (e.touches.length !== 1 || t === undefined) return;
      startY = lastY = t.clientY;
      lastT = e.timeStamp;
      speed = 0;
      dragging = false;
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t === undefined) return;
      const dy = t.clientY - startY;
      if (!dragging) {
        // 下向きで、中身が一番上までスクロールしている時だけ引ける。
        if (dy < 8 || el.scrollTop > 0 || dismissRef.current === undefined) return;
        dragging = true;
        startY = t.clientY;
      }
      e.preventDefault();
      const dt = e.timeStamp - lastT;
      if (dt > 0) speed = (t.clientY - lastY) / dt;
      lastY = t.clientY;
      lastT = e.timeStamp;
      move(Math.max(0, t.clientY - startY));
    };
    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      const dy = lastY - startY;
      if (dy > CLOSE_PX || speed > CLOSE_PX_PER_MS) {
        tick();
        // 引いた位置からそのまま下へ抜ける。
        el.style.transition = `transform ${LEAVE_MS}ms cubic-bezier(0.4, 0, 1, 1)`;
        el.style.transform = 'translateY(110%)';
        bg.style.transition = `opacity ${LEAVE_MS}ms ease-in`;
        bg.style.opacity = '0';
        leaveRef.current();
      } else {
        reset();
      }
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  return (
    <div
      ref={backdrop}
      className={`${styles.backdrop} ${leaving ? styles.leaving : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) leave();
      }}
    >
      <div ref={panel} className={styles.panel} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        <span className={styles.grabber} aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
