import type { EngineSimEvent, HallProjection } from '@ph/core';
import { expect, test } from 'vitest';
import { LcdTimeline } from '../board/lcd-timeline.ts';
import { setLcdView, shownHall, useLcdView } from './lcd-view.ts';

const proj = (over: Record<string, unknown>): HallProjection =>
  ({ holds: [], spin: null, jackpot: null, mode: 'normal', stRemaining: 0, chain: 0, chainBalls: 0, balls: 1000, totals: { jackpots: 3 }, ...over }) as unknown as HallProjection;

const started = { k: 'jackpotStarted', entry: 5, kind: 'normal', rounds: 4, at: 10_000 } as unknown as EngineSimEvent;
const ended = { k: 'jackpotEnded', entry: 5, at: 20_000, payout: 600 } as unknown as EngineSimEvent;

test('Projection は大当たり中・液晶はまだ → 状態行に出ない。液晶が入ると出る', () => {
  const tl = new LcdTimeline();
  tl.push(proj({}), []);
  tl.push(proj({ jackpot: { entry: 5, kind: 'normal', rounds: 4 }, totals: { jackpots: 4 } }), [started]);
  const p = proj({ jackpot: { entry: 5, kind: 'normal', rounds: 4 }, totals: { jackpots: 4 } });
  const view = (now: number) => {
    const s = tl.advance(now);
    const pend = tl.pending();
    return { jackpot: s.jackpot ? { rounds: s.jackpot.rounds } : null, mode: s.rush?.mode ?? 'normal', chain: s.rush?.chain ?? 0, pendingJackpots: pend.jackpots, pendingPayout: pend.payout } as const;
  };
  const before = shownHall(p, view(9_000));
  expect(before.jackpot).toBeNull();
  expect(before.jackpots).toBe(3);
  const after = shownHall(p, view(10_000));
  expect(after.jackpot).toEqual({ rounds: 4 });
  expect(after.jackpots).toBe(4);
});

test('持ち玉は液晶に出ていない大当たりの出玉を引く・view が null なら Projection のまま', () => {
  const tl = new LcdTimeline();
  tl.push(proj({}), []);
  tl.push(proj({ balls: 1600, jackpot: null, totals: { jackpots: 4 } }), [started, ended]);
  expect(tl.pending()).toEqual({ jackpots: 1, payout: 600 });
  const v = { jackpot: null, mode: 'normal', chain: 0, pendingJackpots: 1, pendingPayout: 600 } as const;
  expect(shownHall(proj({ balls: 1600 }), v).balls).toBe(1000);
  expect(shownHall(proj({ balls: 1600, jackpot: { rounds: 4 } }), null)).toMatchObject({ balls: 1600, jackpot: { rounds: 4 } });
});

test('RUSH の継続: 液晶が大当たりに入るまで連チャン数は前のまま', () => {
  const p = proj({ mode: 'st', stRemaining: 100, chain: 2, jackpot: { rounds: 10 } });
  const v = { jackpot: null, mode: 'st', chain: 2, pendingJackpots: 1, pendingPayout: 0 } as const;
  expect(shownHall(p, v).chain).toBe(1);
  expect(shownHall(p, { ...v, jackpot: { rounds: 10 }, chain: 3, pendingJackpots: 0 }).chain).toBe(2);
});

test('setLcdView は変わらない時は set しない', () => {
  const v = { jackpot: null, mode: 'normal', chain: 0, pendingJackpots: 0, pendingPayout: 0 } as const;
  setLcdView(v);
  const a = useLcdView.getState().view;
  setLcdView({ ...v });
  expect(useLcdView.getState().view).toBe(a);
  setLcdView(null);
});
